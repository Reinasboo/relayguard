-- An EVM hash is bytes, not case-sensitive text. Fail atomically if historical
-- duplicate identities exist: review those orders before applying this migration.
begin;
create table if not exists public.relayguard_request_limits (
  key text primary key,
  window_start bigint not null,
  request_count bigint not null
);
create index if not exists relayguard_request_limits_expiry on public.relayguard_request_limits (window_start);
alter table public.relayguard_request_limits enable row level security;
revoke all on public.relayguard_request_limits from public, anon, authenticated;
create unique index if not exists merchant_invoices_transaction_identity
  on public.merchant_invoices (lower(transaction_reference))
  where transaction_reference is not null;
commit;
