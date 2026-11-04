-- Wallet verification is server-attested. Ownership RLS alone must not allow a
-- merchant to set wallet_verified or replace an already verified destination.
revoke insert, update on public.merchant_profiles from authenticated;
grant update (merchant_name) on public.merchant_profiles to authenticated;

comment on column public.merchant_profiles.wallet_verified is
  'Server-attested wallet signature. Browser roles cannot insert or update this field.';
