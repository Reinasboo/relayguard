create table if not exists public.relayguard_authorizations (
  id uuid primary key,
  agent_id text not null,
  idempotency_key text not null,
  network text not null,
  asset text not null,
  amount_atomic text not null check (amount_atomic ~ '^(0|[1-9][0-9]*)$'),
  created_at bigint not null,
  status text not null check (
    status in ('denied', 'awaiting_approval', 'authorized', 'executing', 'submitted',
      'confirmed', 'failed', 'cancelled', 'expired')
  ),
  record_json jsonb not null,
  challenge_hash text,
  unique (agent_id, idempotency_key)
);

create index if not exists relayguard_authorizations_daily_spend
  on public.relayguard_authorizations (agent_id, network, asset, created_at);

create table if not exists public.relayguard_audit_events (
  sequence bigint primary key,
  at bigint not null,
  type text not null,
  record_id uuid not null references public.relayguard_authorizations(id),
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  status text not null,
  previous_hash text not null check (previous_hash ~ '^[0-9a-f]{64}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.relayguard_audit_head (
  id boolean primary key default true check (id),
  sequence bigint not null default 0,
  hash text not null default repeat('0', 64) check (hash ~ '^[0-9a-f]{64}$')
);

insert into public.relayguard_audit_head (id)
values (true)
on conflict (id) do nothing;

drop function if exists public.get_checkout_invoice(uuid);

alter table public.merchant_invoices
  alter column id set default gen_random_uuid(),
  alter column created_at drop default,
  alter column created_at type bigint using (extract(epoch from created_at) * 1000)::bigint,
  alter column expires_at drop default,
  alter column expires_at type bigint using (extract(epoch from expires_at) * 1000)::bigint,
  alter column status set default 'open';

alter table public.merchant_invoices
  add constraint merchant_invoices_authorization_fk
  foreign key (authorization_id) references public.relayguard_authorizations(id);

create function public.get_checkout_invoice(p_invoice_id uuid)
returns table (
  id uuid,
  merchant_name text,
  merchant_address text,
  asset text,
  amount_atomic text,
  description text,
  status text,
  created_at bigint,
  expires_at bigint,
  transaction_reference text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invoice.id,
    invoice.merchant_name,
    invoice.merchant_address,
    invoice.asset,
    invoice.amount_atomic,
    invoice.description,
    case
      when invoice.status = 'open' and invoice.expires_at <= (extract(epoch from now()) * 1000)::bigint then 'expired'
      else invoice.status
    end,
    invoice.created_at,
    invoice.expires_at,
    invoice.transaction_reference
  from public.merchant_invoices invoice
  where invoice.id = p_invoice_id;
$$;

revoke all on function public.get_checkout_invoice(uuid) from public;
grant execute on function public.get_checkout_invoice(uuid) to anon, authenticated;

alter table public.relayguard_authorizations enable row level security;
alter table public.relayguard_audit_events enable row level security;
alter table public.relayguard_audit_head enable row level security;

revoke all on public.relayguard_authorizations from anon, authenticated;
revoke all on public.relayguard_audit_events from anon, authenticated;
revoke all on public.relayguard_audit_head from anon, authenticated;
revoke insert, update, delete on public.merchant_invoices from anon, authenticated;
