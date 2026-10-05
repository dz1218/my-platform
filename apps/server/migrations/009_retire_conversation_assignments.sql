-- Retiring per-conversation assignment must not strand an unclaimed AI in
-- HUMAN/NEVER mode. Keep explicit automation/privacy choices unchanged.
CREATE TEMP TABLE retired_conversation_owners ON COMMIT DROP AS
 SELECT c.id FROM conversations c
 WHERE c.owner_type='HUMAN'
 AND NOT EXISTS(SELECT 1 FROM identity_inheritances h WHERE h.identity_id=c.identity_id)
 ORDER BY c.id FOR UPDATE OF c;

UPDATE conversations SET owner_type='AI',settings_version=settings_version+1,updated_at=now()
 WHERE id IN (SELECT id FROM retired_conversation_owners);
UPDATE proactive_opportunities SET status='CANCELED'
 WHERE conversation_id IN (SELECT id FROM retired_conversation_owners) AND status='QUEUED';
UPDATE reply_items SET status='CANCELED'
 WHERE status='PENDING' AND batch_id IN (
  SELECT id FROM reply_batches WHERE status='PENDING'
  AND conversation_id IN (SELECT id FROM retired_conversation_owners)
 );
UPDATE reply_batches SET status='CANCELED'
 WHERE status='PENDING' AND conversation_id IN (SELECT id FROM retired_conversation_owners);
UPDATE reply_jobs SET status='cancelled',version=version+1,content=NULL,claim_token=NULL,
 lease_until=NULL,updated_at=now()
 WHERE conversation_id IN (SELECT id FROM retired_conversation_owners)
 AND status IN ('queued','generating','scheduled','failed');

-- Start a new generation snapshot rather than delivering drafts prepared for
-- the old owner. Do not replay answered or partially delivered turns, and never
-- resume AI for a user who explicitly disabled automatic interaction.
INSERT INTO reply_jobs(conversation_id,trigger_message_id,status,due_at,policy_json,settings_version,turn_version)
 SELECT c.id,m.id,'queued',now(),COALESCE(j.policy_json,
  '{"version":"inheritance-upgrade-v1","debounceSeconds":1,"maxBufferSeconds":8,"maxAttempts":3,"retrySeconds":15,"maxWaitSeconds":10}'::jsonb),
  c.settings_version,c.turn_version
 FROM conversations c
 JOIN retired_conversation_owners retired ON retired.id=c.id
 CROSS JOIN LATERAL (
  SELECT id FROM messages WHERE conversation_id=c.id AND sender_type='user' ORDER BY id DESC LIMIT 1
 ) m
 LEFT JOIN reply_jobs j ON j.conversation_id=c.id
 WHERE c.automation_enabled AND c.turn_status='OPEN'
 AND NOT EXISTS(SELECT 1 FROM messages later WHERE later.conversation_id=c.id
  AND later.id>m.id AND later.sender_type='identity' AND later.message_kind='TURN_REPLY')
 ON CONFLICT(conversation_id) DO UPDATE SET version=reply_jobs.version+1,
 trigger_message_id=EXCLUDED.trigger_message_id,status='queued',due_at=EXCLUDED.due_at,
 requested_at=now(),policy_json=EXCLUDED.policy_json,settings_version=EXCLUDED.settings_version,
 turn_version=EXCLUDED.turn_version,kind='TURN_REPLY',opportunity_id=NULL,attempts=0,wait_count=0,
 content=NULL,prompt_version=NULL,lease_until=NULL,claim_token=NULL,last_error=NULL,updated_at=now();
