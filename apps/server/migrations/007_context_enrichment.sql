ALTER TABLE conversations ADD COLUMN summary_through_message_id bigint REFERENCES messages(id);
CREATE TABLE context_jobs (
 conversation_id text PRIMARY KEY REFERENCES conversations(id),through_message_id bigint NOT NULL REFERENCES messages(id),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','FAILED')),
 attempts int NOT NULL DEFAULT 0,lease_until timestamptz,claim_token text,settings_version bigint NOT NULL,
 due_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memory_proposals (
 id text PRIMARY KEY,conversation_id text NOT NULL REFERENCES conversations(id),source_message_id bigint NOT NULL REFERENCES messages(id),
 kind text NOT NULL CHECK(kind IN ('FACT','PREFERENCE','EXPERIENCE','BOUNDARY')),content text NOT NULL CHECK(length(content) BETWEEN 1 AND 300),
 provenance text NOT NULL CHECK(provenance IN ('USER_ASSERTED','HUMAN_AUTHORED','AI_FICTIONAL','INFERRED_UNVERIFIED')),
 UNIQUE(conversation_id,source_message_id,kind)
);
