ALTER TABLE users ADD COLUMN session_version BIGINT NOT NULL DEFAULT 0 CHECK (session_version >= 0);

-- Keep the delivery budget after a challenge has been consumed.
CREATE TABLE password_reset_verifications (
    phone TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    session_version BIGINT NOT NULL DEFAULT 0,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    ticket_hash TEXT,
    ticket_expires_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    daily_count INTEGER NOT NULL DEFAULT 1,
    day_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Committed alongside the password. API processes claim with SKIP LOCKED.
CREATE TABLE account_revocations (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, session_version)
);
CREATE INDEX account_revocations_pending ON account_revocations(retry_at) WHERE completed_at IS NULL;
