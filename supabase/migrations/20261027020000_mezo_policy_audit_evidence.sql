alter table public.relayguard_audit_events
  add column if not exists policy_digest text
    check (policy_digest is null or policy_digest ~ '^[0-9a-f]{64}$'),
  add column if not exists mezo_trove_evidence_digest text
    check (mezo_trove_evidence_digest is null or mezo_trove_evidence_digest ~ '^[0-9a-f]{64}$');
