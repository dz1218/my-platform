-- Room incarnations are the boundary for membership and sanctions. Serialized
-- mutations use the existing per-room advisory lock across API replicas.
CREATE TABLE live_room_governance (
  room_sid text PRIMARY KEY,
  room_id text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_room_governance_retention ON live_room_governance(updated_at);
CREATE TABLE live_host_settings (
  owner_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
