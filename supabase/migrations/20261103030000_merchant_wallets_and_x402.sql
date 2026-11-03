alter table public.merchant_profiles
  add column if not exists wallet_verified boolean not null default false;

create table if not exists public.merchant_wallet_challenges (
  id uuid primary key,
  merchant_user_id uuid not null references auth.users (id) on delete cascade,
  address text not null check (address ~* '^0x[0-9a-f]{40}$'),
  message text not null,
  expires_at bigint not null
);

create index if not exists merchant_wallet_challenges_expiry
  on public.merchant_wallet_challenges (expires_at);

create table if not exists public.merchant_x402_resources (
  id uuid primary key,
  merchant_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  method text not null check (method in ('GET', 'POST')),
  route_path text not null check (route_path ~ '^/[A-Za-z0-9/_-]*$' and position('//' in route_path) = 0),
  price text not null check (price ~ '^\$[0-9]+(\.[0-9]{1,18})?$'),
  description text not null check (length(trim(description)) between 1 and 240),
  created_at bigint not null,
  unique (merchant_user_id, method, route_path)
);

create index if not exists merchant_x402_resources_owner_created
  on public.merchant_x402_resources (merchant_user_id, created_at desc);

create table if not exists public.merchant_x402_api_keys (
  id uuid primary key,
  resource_id uuid not null unique references public.merchant_x402_resources (id) on delete cascade,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix text not null,
  created_at bigint not null,
  last_used_at bigint,
  revoked_at bigint
);

alter table public.merchant_wallet_challenges enable row level security;
alter table public.merchant_x402_resources enable row level security;
alter table public.merchant_x402_api_keys enable row level security;

revoke all on public.merchant_wallet_challenges from anon, authenticated;
revoke all on public.merchant_x402_resources from anon, authenticated;
revoke all on public.merchant_x402_api_keys from anon, authenticated;
