-- Platform audit anchor (FIG-1566, finding F-03 of docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md).
--
-- One statement, so one snapshot: every row of platform_audit_events, oldest first, one JSON object per line, then one last line
-- ("kind":"head") that states how many rows there are and what the head of the chain is. It is read by two callers, so the two
-- cannot drift:
--   * ops/backup/backup-nightly.sh   psql -X -At -v ON_ERROR_STOP=1 -f audit-export.sql
--   * scripts/platform-audit-anchor.ts export   (the hosted database, over DATABASE_URL, read-only)
--
-- The columns are exported as the text Postgres itself feeds to the hash (`occurred_text`, `metadata_text`), so a restore check can
-- recompute every row's hash with the same recipe as platform_audit_row_hash() (migration 20261105100000) without having to
-- reproduce how Postgres writes jsonb. Rows carry no values, payments or secrets by construction (platformAuditService.ts).
WITH e AS (SELECT * FROM platform_audit_events)
SELECT line FROM (
  SELECT 0 AS part, e.seq AS seq, json_build_object(
    'kind', 'row',
    'seq', e.seq::text,
    'id', e.id,
    'occurred_text', to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'actor_identity_id', e.actor_identity_id,
    'actor_label', e.actor_label,
    'action', e.action,
    'target_type', e.target_type,
    'target_id', e.target_id,
    'organization_id', e.organization_id,
    'organization_slug', e.organization_slug,
    'reason', e.reason,
    'metadata_text', e.metadata::text,
    'request_id', e.request_id,
    'prev_hash', e.prev_hash,
    'hash', e.hash
  )::text AS line FROM e
  UNION ALL
  SELECT 1, 0, json_build_object(
    'kind', 'head',
    'rows', (SELECT count(*) FROM e)::text,
    'head_seq', coalesce((SELECT max(seq) FROM e), 0)::text,
    'head_hash', coalesce((SELECT hash FROM e ORDER BY seq DESC LIMIT 1), 'GENESIS')
  )::text
) t ORDER BY part, seq;
