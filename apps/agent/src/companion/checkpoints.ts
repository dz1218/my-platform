import { createHash } from "node:crypto";
import pg from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { RunContext, Usage } from "../schemas/runtime.js";

export const checkpointSchema = "companion_runtime";
export const graphVersion = "companion-graph-v1";
export type Budget = { reserve: (kind: "model" | "retrieval") => Promise<void>; usage: (input: number, output: number) => Promise<void>; stats: () => Promise<Usage> };

export class Checkpoints {
  readonly pool: pg.Pool;
  readonly saver: PostgresSaver;
  constructor(url: string, readonly runtimeVersion = graphVersion) {
    this.pool = new pg.Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
    this.saver = new PostgresSaver(this.pool, undefined, { schema: checkpointSchema });
  }
  // Deployment command only: the serving role needs no CREATE privileges.
  async migrate() {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${checkpointSchema}`);
    await this.saver.setup();
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${checkpointSchema}.runs (
      thread_id text PRIMARY KEY, conversation_id text NOT NULL, memory_revision bigint NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
      model_calls integer NOT NULL DEFAULT 0, retrieval_calls integer NOT NULL DEFAULT 0,
      input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0)`);
    await this.pool.query(`CREATE INDEX IF NOT EXISTS runs_owner ON ${checkpointSchema}.runs(conversation_id,memory_revision)`);
  }
  async ready(restricted = false) {
    await this.pool.query(`SELECT thread_id FROM ${checkpointSchema}.runs LIMIT 0`);
    await this.pool.query(`SELECT thread_id FROM ${checkpointSchema}.checkpoints LIMIT 0`);
    if (restricted) {
      const result = await this.pool.query(`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreatedb OR rolcreaterole)) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('companion_runtime','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p','v','m') AND (has_table_privilege(current_user,c.oid,'SELECT') OR has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE'))) AS business_access`);
      if (result.rows[0].business_access) throw new Error("checkpoint_role_has_business_access");
    }
  }
  async withRun<T>(run: RunContext, fn: (threadId: string, budget: Budget) => Promise<T>, modelLimit = 3): Promise<T> {
    const threadId = createHash("sha256").update(`${this.runtimeVersion}:${run.conversationId}:${run.id}:${run.inputHash}`).digest("hex");
    const client = await this.pool.connect();
    let locked = false;
    try {
      locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [threadId])).rows[0].locked;
      if (!locked) throw new Error("run_busy");
      await client.query(`INSERT INTO ${checkpointSchema}.runs(thread_id,conversation_id,memory_revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [threadId, run.conversationId, run.memoryRevision]);
      const budget: Budget = {
        reserve: async kind => {
          const column = kind === "model" ? "model_calls" : "retrieval_calls", limit = kind === "model" ? Math.min(3, modelLimit) : 2;
          const result = await client.query(`UPDATE ${checkpointSchema}.runs SET ${column}=${column}+1 WHERE thread_id=$1 AND ${column}<$2 RETURNING thread_id`, [threadId, limit]);
          if (!result.rowCount) throw new Error("execution_budget_exceeded");
        },
        usage: async (input, output) => { await client.query(`UPDATE ${checkpointSchema}.runs SET input_tokens=input_tokens+$2,output_tokens=output_tokens+$3 WHERE thread_id=$1`, [threadId, input, output]); },
        stats: async () => {
          const row = (await client.query(`SELECT model_calls,retrieval_calls,input_tokens,output_tokens FROM ${checkpointSchema}.runs WHERE thread_id=$1`, [threadId])).rows[0];
          return { modelCalls: row.model_calls, retrievalCalls: row.retrieval_calls, inputTokens: row.input_tokens, outputTokens: row.output_tokens };
        },
      };
      return await fn(threadId, budget);
    } finally { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [threadId]).catch(() => {}); client.release(); }
  }
  async purge(conversationId?: string, beforeRevision?: number) {
    const client = await this.pool.connect(); let busy = false;
    try {
      const rows = (await client.query(`SELECT thread_id FROM ${checkpointSchema}.runs WHERE ${conversationId ? "conversation_id=$1 AND memory_revision<$2" : "expires_at<now()"} LIMIT 100`, conversationId ? [conversationId, beforeRevision] : [])).rows;
      for (const { thread_id: id } of rows) {
        const locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [id])).rows[0].locked;
        if (!locked) { busy = true; continue; }
        try { await this.saver.deleteThread(id); await client.query(`DELETE FROM ${checkpointSchema}.runs WHERE thread_id=$1`, [id]); }
        finally { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [id]); }
      }
      // More than one page is retried by the durable Go cleanup task.
      return !busy && rows.length < 100;
    } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}
