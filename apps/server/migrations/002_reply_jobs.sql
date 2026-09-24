-- One durable, versioned reply slot per conversation. New input invalidates old drafts.
CREATE TABLE reply_jobs (
 conversation_id text PRIMARY KEY REFERENCES conversations(id),
 version bigint NOT NULL DEFAULT 1,
 trigger_message_id bigint NOT NULL REFERENCES messages(id),
 status text NOT NULL CHECK(status IN ('queued','generating','scheduled','delivered','failed','cancelled')),
 due_at timestamptz NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 claim_token text,
 attempts integer NOT NULL DEFAULT 0,
 content text,
 prompt_version text,
 policy_json jsonb NOT NULL,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reply_jobs_due ON reply_jobs(status,due_at);
CREATE INDEX reply_jobs_lease ON reply_jobs(lease_until) WHERE status='generating';
ALTER TABLE messages ADD COLUMN reply_version bigint;
CREATE UNIQUE INDEX messages_reply_once ON messages(conversation_id,reply_version) WHERE reply_version IS NOT NULL;
-- Interrupted requests from the retired SSE implementation are retryable.
UPDATE messages SET status='failed' WHERE status='pending';
