# Product and security audit — November 5, 2026

This revision hardens merchant checkout, x402 route enforcement, public request handling and hosted database connections. It builds on the Wave 2 submission-materials PR #4; those demo, seven-screen and deck assets remain in that PR.

## Findings and fixes

| Finding | Impact | Implemented protection |
| --- | --- | --- |
| A nested Vercel route alias was interpreted again after x402 middleware | Critical: protected content could be returned without payment | Resolve one canonical path before middleware; reject nested, repeated or malformed aliases. Both direct and rewritten paid routes require HTTP 402. |
| An older matching transfer could settle a newly authorized invoice | High: a historical payment could be reused for a new order | Read the receipt's exact block and require its timestamp to be at least authorization creation time, allowing 999 ms for block timestamp precision. |
| Upper/lowercase transaction hashes had different database identities | High: the same transaction bytes could be recorded twice | Normalize submitted hashes and enforce a unique lowercase expression index in SQLite and Postgres. |
| A verified payer could claim an unrelated public transaction hash | High: another buyer's payment recording could be blocked | Before reserving the hash, fetch the actual transaction and check payer, canonical MUSD contract, zero native value, transfer recipient and exact amount. Unavailable transactions return retryable 503, without claiming the hash. |
| Operator treasury limits applied to buyer-funded orders | Product blocker: valid customer orders above 25 MUSD were rejected | Give buyer checkout an invoice-specific exact-amount policy. Operator treasury and trove rules retain their separate policy. |
| Amounts outside uint256 and expired payment attempts remained actionable | Product integrity and wallet failures | Reject impossible token amounts, reject fresh signatures/authorization after expiry, check expiry before opening the transfer prompt, and update expired open orders in merchant lists. Already-broadcast payments retain recording/reconciliation support. |
| Broad preview-host acceptance and late origin checks | Unconfigured hosts and cross-origin requests reached sensitive middleware | Explicit configured host allowlist and origin validation before x402. Trust one proxy hop only on Vercel. |
| Infrastructure errors were returned to clients | Private RPC URLs or database diagnostics could leak | Public errors use controlled messages and appropriate status codes; diagnostic details remain in server logs. Oversized JSON returns 413. Express middleware failures reach a final error handler. |
| Wallet and public RPC endpoints had no shared throttling | Repeated requests could exhaust upstream capacity | Atomic database-backed fixed windows: 120 wallet/payment POSTs and 60 RPC-backed GETs per client IP per minute. Return 429 and Retry-After. Persist only an HMAC of the IP; expire old counters. |
| Postgres disabled certificate verification | An encrypted connection did not authenticate the database server | Always verify certificate and hostname, remove URL flags that could override verification, and support the project's PEM CA through SUPABASE_DB_CA_CERT. |
| Static Vercel assets bypassed application security headers | Production HTML lacked the same browser policy as locally served HTML | Apply CSP, nosniff, frame denial and no-referrer headers globally through vercel.json; align the local HTML CSP. |

## Validation

- `npm test`: TypeScript/browser build and complete Node test suite. The new regressions exercise actual Express routing, x402 middleware and real SQLite stores, with external auth/RPC/facilitator calls mocked. Postgres TLS tests construct the actual pg client and verify that URI flags cannot disable authentication.
- `node --check public/app.js`: browser script syntax.
- `node scripts/verify-ui.mjs`, with `RELAYGUARD_UI_OUTPUT=tmp/security-ui`: responsive review page at 390, 768 and 1440 px; four policy outcomes; amount cap; merchant default workspace; denied review mutations; broadcast reload recovery without another wallet call. Zero browser page errors. The evidence refresh also verified the two historical Testnet receipts during this run.
- `npm audit --json`: zero reported dependency vulnerabilities at audit time. This does not establish the absence of application vulnerabilities.
- Request limiter tests include two independent SQLite connections sharing one counter, plus real HTTP 429/Retry-After behavior. Checkout tests cover malformed/unrelated transactions, delayed network visibility, old receipt rejection and valid new settlement.

Exact test totals and browser results are recorded in `validation-2026-11-05.json`.

## Deployment sequence

1. Back up the hosted database and inspect existing duplicate hash identities before the migration:

   ```sql
   select lower(transaction_reference) as identity, count(*)
   from public.merchant_invoices
   where transaction_reference is not null
   group by lower(transaction_reference)
   having count(*) > 1;
   ```

   If any exist, reconcile their payment/order records before proceeding. The migration deliberately fails atomically rather than deleting or silently rewriting historical orders.

2. Apply `supabase/migrations/20261105000000_transaction_identity.sql` after the earlier migrations. It adds the unique hash index and private, RLS-enabled request-limit table. The backend database role needs table access; anon/authenticated browser roles receive none. Startup checks require the new table.
3. Download the database CA from the Supabase project Dashboard if the server certificate uses a private CA. Set `SUPABASE_DB_CA_CERT` to that PEM in the deployment environment. Keep `DATABASE_URL` private. SSL URI flags cannot opt out of authentication. See [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) and [connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. Verify `PUBLIC_ORIGIN` / `PUBLIC_HOSTNAME`, `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` cover the intended hosts. Use a stable `RELAYGUARD_CHECKOUT_SECRET` across instances; rotating it invalidates existing checkout capabilities and changes request-counter identities.
5. Deploy the audited branch after maintainer review. Verify actual hosted Postgres startup, API health, static-page headers, HTTP 402 on both route forms and a fresh authenticated Testnet invoice. Check delayed visibility/reload recovery with the same payment hash. Do not resend a payment to resolve a recording failure.

## Scope and remaining deployment work

No hosted migration, database credential change, deployment or funded wallet transaction was performed for this audit. Live Postgres migration execution and certificate-chain connectivity require the deployment credentials and project CA; the local pg configuration tests do not replace those checks. Existing historical Testnet evidence was read only.

This is a Mezo Testnet revision, not a security certification or mainnet release. Confirmation-depth/reorganization policy, external signing custody, operational monitoring and independent review remain production work. Application throttles supplement infrastructure abuse controls; shared-IP clients use the same fixed window. A wallet prompt can remain open across an invoice deadline; the UI checks before prompting, and valid already-broadcast transactions remain recoverable afterward.
