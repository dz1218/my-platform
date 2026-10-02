ALTER TABLE conversations ADD COLUMN automation_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE proactive_preferences (
 conversation_id text PRIMARY KEY REFERENCES conversations(id),
 user_opt_in boolean NOT NULL DEFAULT false,allow_proactive_ai boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'Asia/Shanghai',quiet_start integer NOT NULL DEFAULT 1320 CHECK(quiet_start BETWEEN 0 AND 1439),
 quiet_end integer NOT NULL DEFAULT 540 CHECK(quiet_end BETWEEN 0 AND 1439),
 max_batches_per_24h integer NOT NULL DEFAULT 1 CHECK(max_batches_per_24h BETWEEN 1 AND 3),
 min_gap_minutes integer NOT NULL DEFAULT 480 CHECK(min_gap_minutes BETWEEN 480 AND 10080),
 version bigint NOT NULL DEFAULT 1
);
CREATE TABLE proactive_opportunities (
 id text PRIMARY KEY,conversation_id text NOT NULL REFERENCES conversations(id),
 topic_key text NOT NULL,source_message_id bigint NOT NULL REFERENCES messages(id),
 due_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>due_at),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','QUEUED','CONSUMED','SILENCE','EXPIRED','CANCELED')),
 consumed_batch_id text UNIQUE REFERENCES reply_batches(id),attempted_at timestamptz,
 UNIQUE(conversation_id,topic_key),UNIQUE(conversation_id,source_message_id)
);
CREATE INDEX proactive_due ON proactive_opportunities(due_at) WHERE status='PENDING';
ALTER TABLE reply_batches ADD CONSTRAINT batch_opportunity FOREIGN KEY(opportunity_id) REFERENCES proactive_opportunities(id);
CREATE UNIQUE INDEX proactive_batch_once ON reply_batches(opportunity_id) WHERE opportunity_id IS NOT NULL;
ALTER TABLE reply_jobs ADD COLUMN kind text NOT NULL DEFAULT 'TURN_REPLY' CHECK(kind IN ('TURN_REPLY','PROACTIVE')),
 ADD COLUMN opportunity_id text REFERENCES proactive_opportunities(id);
CREATE TABLE conversation_memories (
 id text PRIMARY KEY,conversation_id text NOT NULL REFERENCES conversations(id),kind text NOT NULL CHECK(kind IN ('FACT','PREFERENCE','EXPERIENCE','BOUNDARY')),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 300),source_message_id bigint NOT NULL REFERENCES messages(id),
 provenance text NOT NULL CHECK(provenance IN ('USER_ASSERTED','HUMAN_AUTHORED','AI_FICTIONAL','INFERRED_UNVERIFIED')),
 version bigint NOT NULL DEFAULT 1,deleted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,source_message_id,kind)
);
CREATE TABLE identity_daily_state (
 identity_id text PRIMARY KEY REFERENCES identities(id),fictional boolean NOT NULL DEFAULT true CHECK(fictional),
 current_activity text NOT NULL,mood text NOT NULL DEFAULT '',paused boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL,editor_id text REFERENCES users(id)
);
CREATE TABLE conversation_presence (
 conversation_id text NOT NULL REFERENCES conversations(id),actor_id text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,PRIMARY KEY(conversation_id,actor_id)
);

ALTER TABLE conversations DROP CONSTRAINT conversations_reply_delay_seconds_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_reply_delay_seconds_check CHECK(reply_delay_seconds BETWEEN 0 AND 86400);
ALTER TABLE conversations ALTER COLUMN reply_delay_seconds SET DEFAULT 120;
