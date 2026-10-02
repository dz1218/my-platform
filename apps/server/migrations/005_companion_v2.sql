ALTER TABLE conversations
 ADD COLUMN turn_id text,
 ADD COLUMN turn_status text NOT NULL DEFAULT 'ANSWERED' CHECK(turn_status IN ('OPEN','PARTIALLY_SENT','ANSWERED')),
 ADD COLUMN buffer_started_at timestamptz,
 ADD COLUMN summary text NOT NULL DEFAULT '',
 ADD COLUMN memory_opt_in boolean NOT NULL DEFAULT false;
UPDATE conversations c SET turn_id=c.id||'-legacy',turn_status='OPEN',buffer_started_at=j.requested_at
 FROM reply_jobs j WHERE j.conversation_id=c.id AND j.status IN ('queued','generating','scheduled');
UPDATE reply_jobs SET status='queued',version=version+1,claim_token=NULL,lease_until=NULL,content=NULL WHERE status IN ('generating','scheduled');
CREATE TABLE reply_batches (
 id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES conversations(id),
 job_version bigint NOT NULL, turn_id text, turn_version bigint NOT NULL, settings_version bigint NOT NULL,
 kind text NOT NULL DEFAULT 'TURN_REPLY' CHECK(kind IN ('TURN_REPLY','PROACTIVE')),
 opportunity_id text, status text NOT NULL CHECK(status IN ('PENDING','COMPLETED','CANCELED')),
 next_item_index int NOT NULL DEFAULT 0, prompt_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,job_version)
);
CREATE TABLE reply_items (
 id text PRIMARY KEY,batch_id text NOT NULL REFERENCES reply_batches(id),item_index int NOT NULL,
 client_item_key text NOT NULL,content text NOT NULL CHECK(length(btrim(content)) BETWEEN 1 AND 500),
 due_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMMITTED','CANCELED')),
 committed_message_id bigint UNIQUE REFERENCES messages(id),
 UNIQUE(batch_id,item_index),UNIQUE(batch_id,client_item_key)
);
CREATE INDEX reply_items_due ON reply_items(due_at) WHERE status='PENDING';
ALTER TABLE messages ADD COLUMN reply_batch_id text REFERENCES reply_batches(id),
 ADD COLUMN reply_item_id text UNIQUE REFERENCES reply_items(id),
 ADD COLUMN message_kind text NOT NULL DEFAULT 'TURN_REPLY' CHECK(message_kind IN ('TURN_REPLY','PROACTIVE'));
CREATE TABLE message_outbox (
 message_id bigint PRIMARY KEY REFERENCES messages(id),conversation_id text NOT NULL REFERENCES conversations(id),
 event_type text NOT NULL DEFAULT 'message.created',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_outbox_cursor ON message_outbox(conversation_id,message_id);
INSERT INTO message_outbox(message_id,conversation_id) SELECT id,conversation_id FROM messages;
CREATE FUNCTION enqueue_message_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO message_outbox(message_id,conversation_id) VALUES(NEW.id,NEW.conversation_id); RETURN NEW;
END $$;
CREATE TRIGGER messages_outbox AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION enqueue_message_event();
