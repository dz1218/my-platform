ALTER TABLE users ADD COLUMN gender text CHECK (gender IN ('FEMALE','MALE')),
 ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
ALTER TABLE identities ADD COLUMN gender text NOT NULL DEFAULT 'FEMALE' CHECK (gender IN ('FEMALE','MALE'));

-- A claim belongs to the identity for its lifetime, rather than one chat.
CREATE TABLE identity_inheritances (
 identity_id text PRIMARY KEY REFERENCES identities(id),
 user_id text NOT NULL UNIQUE REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_identity ON conversations(identity_id);

CREATE FUNCTION preserve_identity_inheritance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Identity inheritance cannot be transferred or removed' USING ERRCODE='23514';
END $$;
CREATE TRIGGER identity_inheritance_immutable BEFORE UPDATE OR DELETE ON identity_inheritances
 FOR EACH ROW EXECUTE FUNCTION preserve_identity_inheritance();
