-- Waiting is a durable agent action, separate from failure retries.
ALTER TABLE reply_jobs ADD COLUMN wait_count integer NOT NULL DEFAULT 0 CHECK(wait_count >= 0);
