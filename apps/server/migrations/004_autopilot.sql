ALTER TABLE conversations
 ADD COLUMN owner_type text NOT NULL DEFAULT 'AI' CHECK(owner_type IN ('AI','HUMAN')),
 ADD COLUMN auto_reply_mode text NOT NULL DEFAULT 'NEVER' CHECK(auto_reply_mode IN ('NEVER','TIMEOUT','ALWAYS')),
 ADD COLUMN reply_delay_seconds integer NOT NULL DEFAULT 60 CHECK(reply_delay_seconds IN (15,30,60,180,300,600)),
 ADD COLUMN settings_version bigint NOT NULL DEFAULT 1,
 ADD COLUMN turn_version bigint NOT NULL DEFAULT 0;
-- Assignment is provisioned by a trusted administrator, never by the chat client.
CREATE TABLE conversation_takeovers (
 conversation_id text PRIMARY KEY REFERENCES conversations(id),
 operator_id text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_takeovers_operator ON conversation_takeovers(operator_id);
CREATE TABLE conversation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id text NOT NULL REFERENCES conversations(id),
 actor_id text NOT NULL REFERENCES users(id),
 action text NOT NULL,
 details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN actor_id text REFERENCES users(id);
UPDATE messages m SET actor_id=c.user_id FROM conversations c WHERE c.id=m.conversation_id AND m.sender_type='user';
CREATE UNIQUE INDEX messages_human_request ON messages(conversation_id,actor_id,request_id) WHERE driver_type='human';
ALTER TABLE reply_jobs ADD COLUMN settings_version bigint NOT NULL DEFAULT 1,
 ADD COLUMN turn_version bigint NOT NULL DEFAULT 0;
