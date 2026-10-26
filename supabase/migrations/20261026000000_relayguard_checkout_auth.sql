create table if not exists public.merchant_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  merchant_name text not null check (length(trim(merchant_name)) between 1 and 120),
  merchant_address text not null check (merchant_address ~* '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_invoices (
  id uuid primary key default gen_random_uuid(),
  merchant_user_id uuid not null references auth.users (id) on delete cascade,
  merchant_name text not null check (length(trim(merchant_name)) between 1 and 120),
  merchant_address text not null check (merchant_address ~* '^0x[0-9a-f]{40}$'),
  asset text not null default 'MUSD' check (asset = 'MUSD'),
  amount_atomic text not null check (amount_atomic ~ '^[1-9][0-9]*$'),
  description text not null check (length(trim(description)) between 1 and 120),
  status text not null default 'open'
    check (status in ('open', 'authorized', 'submitted', 'paid', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  authorization_id uuid unique,
  transaction_reference text unique
    check (transaction_reference is null or transaction_reference ~* '^0x[0-9a-f]{64}$'),
  constraint merchant_invoices_expiry_after_create check (expires_at > created_at)
);

create index if not exists merchant_invoices_owner_created
  on public.merchant_invoices (merchant_user_id, created_at desc);

create index if not exists merchant_invoices_open_expiry
  on public.merchant_invoices (expires_at)
  where status = 'open';

alter table public.merchant_profiles enable row level security;
alter table public.merchant_invoices enable row level security;

drop policy if exists "Merchants read their profile" on public.merchant_profiles;
create policy "Merchants read their profile"
  on public.merchant_profiles for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Merchants create their profile" on public.merchant_profiles;
create policy "Merchants create their profile"
  on public.merchant_profiles for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Merchants update their profile" on public.merchant_profiles;
create policy "Merchants update their profile"
  on public.merchant_profiles for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Merchants read their invoices" on public.merchant_invoices;
create policy "Merchants read their invoices"
  on public.merchant_invoices for select
  to authenticated
  using (merchant_user_id = (select auth.uid()));

drop policy if exists "Merchants create their invoices" on public.merchant_invoices;
create policy "Merchants create their invoices"
  on public.merchant_invoices for insert
  to authenticated
  with check (
    merchant_user_id = (select auth.uid())
    and status = 'open'
    and authorization_id is null
    and transaction_reference is null
    and exists (
      select 1
      from public.merchant_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.merchant_name = merchant_invoices.merchant_name
        and lower(profile.merchant_address) = lower(merchant_invoices.merchant_address)
    )
  );

create or replace function public.get_checkout_invoice(p_invoice_id uuid)
returns table (
  id uuid,
  merchant_name text,
  merchant_address text,
  asset text,
  amount_atomic text,
  description text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
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
      when invoice.status = 'open' and invoice.expires_at <= now() then 'expired'
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

revoke all on public.merchant_profiles from anon;
revoke all on public.merchant_invoices from anon;
grant select, insert, update on public.merchant_profiles to authenticated;
grant select, insert on public.merchant_invoices to authenticated;
