-- Keep legacy email accounts and their content; new accounts use verified phones.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
CREATE TABLE IF NOT EXISTS phone_verifications (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    ticket_hash TEXT,
    ticket_expires_at TIMESTAMPTZ,
    daily_count INTEGER NOT NULL DEFAULT 1,
    day_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
