-- The live delivery buffer is short-lived; assistants can query the public
-- transcript of the current broadcast independently of that buffer.
CREATE TABLE live_room_chat_history (
  room_sid text NOT NULL REFERENCES live_room_governance(room_sid) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  member_id text NOT NULL,
  name text NOT NULL,
  text text NOT NULL,
  message jsonb NOT NULL,
  PRIMARY KEY (room_sid, sequence)
);
