-- NOTIFY is delivered only after commit, including writes from separate worker
-- processes. Payloads contain only routing IDs; sockets read authorized snapshots.
CREATE FUNCTION notify_account_matches_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  PERFORM pg_notify('companion_matches_changed', json_build_object('schema',TG_TABLE_SCHEMA,'userId',OLD.user_id)::text);
  RETURN OLD;
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
  PERFORM pg_notify('companion_matches_changed', json_build_object('schema',TG_TABLE_SCHEMA,'userId',OLD.user_id)::text);
 END IF;
 PERFORM pg_notify('companion_matches_changed', json_build_object('schema',TG_TABLE_SCHEMA,'userId',NEW.user_id)::text);
 RETURN NEW;
END $$;

-- Every persisted user/human/AI message advances conversations.updated_at.
CREATE TRIGGER conversations_matches_changed
 AFTER INSERT OR DELETE OR UPDATE OF updated_at,user_id,match_id,identity_id ON conversations
 FOR EACH ROW EXECUTE FUNCTION notify_account_matches_changed();

-- Claiming an identity removes one's own match from matching.Repository.List.
CREATE TRIGGER inheritance_matches_changed
 AFTER INSERT OR UPDATE OR DELETE ON identity_inheritances
 FOR EACH ROW EXECUTE FUNCTION notify_account_matches_changed();
