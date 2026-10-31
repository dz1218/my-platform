-- Install extensions with the migration role, never the Agent runtime role.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

ALTER TABLE conversations
 ADD COLUMN memory_consent_version integer NOT NULL DEFAULT 0,
 ADD COLUMN memory_revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN memory_forget_through bigint NOT NULL DEFAULT 0;
-- Legacy switches were controlled by identity operators, not the participant.
UPDATE conversations SET memory_opt_in=false,summary='',summary_through_message_id=NULL,settings_version=settings_version+1;
ALTER TABLE conversation_memories
 ADD COLUMN manual boolean NOT NULL DEFAULT false,
 ADD COLUMN fact_key text NOT NULL DEFAULT '',
 ADD COLUMN assertion text NOT NULL DEFAULT 'UNCERTAIN' CHECK(assertion IN ('ASSERTION','PLAN','UNCERTAIN')),
 ADD COLUMN valid_until timestamptz;
ALTER TABLE memory_proposals
 ADD COLUMN version bigint NOT NULL DEFAULT 1,
 ADD COLUMN fact_key text NOT NULL DEFAULT '',
 ADD COLUMN reason text NOT NULL DEFAULT '需要确认',
 ADD COLUMN assertion text NOT NULL DEFAULT 'UNCERTAIN' CHECK(assertion IN ('ASSERTION','PLAN','UNCERTAIN')),
 ADD COLUMN valid_until timestamptz;
CREATE TABLE agent_forgotten_sources (
 conversation_id text NOT NULL REFERENCES conversations(id),
 source_message_id bigint NOT NULL REFERENCES messages(id),
 PRIMARY KEY(conversation_id,source_message_id)
);
CREATE TABLE agent_runs (
 id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES conversations(id),
 kind text NOT NULL, job_version bigint NOT NULL, claim_token text NOT NULL,
 settings_version bigint NOT NULL, turn_version bigint NOT NULL, memory_revision bigint NOT NULL,
 persona_version bigint NOT NULL, through_message_id bigint NOT NULL,
 input_hash text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_expiry ON agent_runs(expires_at);
ALTER TABLE reply_batches ADD COLUMN agent_execution jsonb;
CREATE TABLE agent_documents (
 id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES conversations(id),
 source_kind text NOT NULL CHECK(source_kind IN ('memory','message','identity')),
 source_id text NOT NULL, source_version bigint NOT NULL,
 content text NOT NULL, content_hash text NOT NULL,
 embedding public.vector(1024), embedding_model text, embedding_hash text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,source_kind,source_id)
);
CREATE INDEX agent_documents_scope ON agent_documents(conversation_id,source_kind);
CREATE INDEX agent_documents_keywords ON agent_documents USING gin(content public.gin_trgm_ops);
CREATE TABLE agent_index_jobs (
 document_id text PRIMARY KEY REFERENCES agent_documents(id) ON DELETE CASCADE,
 content_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'PENDING', due_at timestamptz NOT NULL DEFAULT now(),
 claim_token text, lease_until timestamptz
);
CREATE FUNCTION queue_agent_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.content_hash<>OLD.content_hash THEN
  INSERT INTO agent_index_jobs(document_id,content_hash) VALUES(NEW.id,NEW.content_hash)
  ON CONFLICT(document_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,status='PENDING',attempts=0,due_at=now(),claim_token=NULL,lease_until=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_document_outbox AFTER INSERT OR UPDATE ON agent_documents FOR EACH ROW EXECUTE FUNCTION queue_agent_document();
CREATE TABLE agent_backfills (
 conversation_id text PRIMARY KEY REFERENCES conversations(id),
 through_message_id bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), dirty boolean NOT NULL DEFAULT true
);
CREATE INDEX agent_backfills_due ON agent_backfills(updated_at,conversation_id) WHERE dirty;
CREATE FUNCTION queue_agent_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO agent_backfills(conversation_id,through_message_id)
 SELECT id,memory_forget_through FROM conversations WHERE id=NEW.conversation_id AND memory_opt_in AND memory_consent_version=2
 ON CONFLICT(conversation_id) DO UPDATE SET dirty=true;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_message_sync AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION queue_agent_sync();
CREATE TRIGGER agent_memory_sync AFTER INSERT OR UPDATE ON conversation_memories FOR EACH ROW EXECUTE FUNCTION queue_agent_sync();
CREATE FUNCTION queue_agent_persona_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.persona_version<>OLD.persona_version THEN
  INSERT INTO agent_backfills(conversation_id,through_message_id)
  SELECT id,memory_forget_through FROM conversations WHERE identity_id=NEW.id AND memory_opt_in AND memory_consent_version=2 ORDER BY id
  ON CONFLICT(conversation_id) DO UPDATE SET dirty=true;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_persona_sync AFTER UPDATE ON identities FOR EACH ROW EXECUTE FUNCTION queue_agent_persona_sync();
CREATE TABLE agent_cleanup_jobs (
 conversation_id text PRIMARY KEY REFERENCES conversations(id),
 before_revision bigint NOT NULL, due_at timestamptz NOT NULL DEFAULT now()
);
