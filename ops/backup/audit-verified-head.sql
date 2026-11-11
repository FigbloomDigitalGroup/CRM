-- Platform audit anchor (FIG-1566): the head that the last PASSING verification run recorded (platform_audit_verifications).
-- One JSON line, or no line when no run has passed yet. Stored beside the export so a restore check can compare the two.
SELECT json_build_object(
  'kind', 'verified_head',
  'head_seq', head_seq::text,
  'head_hash', head_hash,
  'run_at', to_char(run_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS')
)::text AS line
FROM platform_audit_verifications
WHERE ok
ORDER BY run_at DESC, id DESC
LIMIT 1;
