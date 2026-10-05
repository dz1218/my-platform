-- Some existing databases applied 006 before its reply-delay adjustment was
-- added. Reconcile their constraint without rewriting stored chat settings.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_reply_delay_seconds_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_reply_delay_seconds_check CHECK(reply_delay_seconds BETWEEN 0 AND 86400);
ALTER TABLE conversations ALTER COLUMN reply_delay_seconds SET DEFAULT 120;
