# Build status

Updated: 2026-10-26

## Product

RelayGuard combines **MUSD merchant checkout and x402 paid resources** in one Mezo product. Merchants can accept QR invoices from people or publish a protected HTTP resource that agents unlock by paying MUSD. Both routes pay the same merchant wallet; merchant/operator controls use Supabase Auth. See the [Mezo product strategy](./hackathons/mezo/PRODUCT_STRATEGY.md).

## Implemented

- Deterministic integer-based spending policy, idempotency, approval challenges, constrained lifecycle transitions, and hash-linked audit events.
- SQLite persistence for authorization, audit, and checkout invoice state; startup fails closed if audit-chain verification fails.
- Versioned typed adapter contract and registry. Mezo supports native BTC and testnet MUSD; Solana x402, NEAR, and Lightning remain fail-closed adapter foundations.
- Local Mezo Testnet console and API for wallet/network status, policy review, explicit operator execution, receipt verification, and audit evidence.
- Merchant workspace, durable MUSD invoices, expiry and reservation controls, shareable checkout URLs, locally generated QR codes, and direct buyer-wallet signing.
- Browser x402 EVM client and Express payment middleware for a `$0.001 MUSD` protected resource on Mezo Testnet. Mezo facilitator capability sync succeeds; unpaid HTTP requests return 402 with the expected canonical MUSD token, amount, recipient, and chain ID.
- Supabase CLI 2.122.0 authenticated and linked to project `relayguard`; email Auth provider enabled, local callback URLs allowlisted, publishable key configured in ignored local app config. Merchant invoices are user-ID scoped in SQLite, and operator audit/payment endpoints require a verified Supabase bearer token.
- Separate merchant wallet generated and stored in ignored `.env.wallets.local`; buyer/operator wallet retained separately. No wallet key was committed or printed as output.
- Supabase Postgres migration prepared with RLS and previewed successfully. Remote migration apply timed out; database password and a reachable database connection are still needed. Current persistence remains local SQLite.
- Invoice authorization binds the payer, merchant, exact MUSD amount, and policy record. Settlement requires a matching successful MUSD `Transfer` event and exact sender, recipient, and amount before the invoice becomes paid.
- Checkout rejects insufficient MUSD before reserving an invoice. Wallet rejection can release an unsubmitted authorization; malformed transaction hashes are rejected before state transitions.
- User-authorized minimum MUSD testnet borrow executed through official `BorrowerOperations`: 1,800 MUSD against 0.045 BTC collateral; receipt verified.
- Authenticated merchant created a 1.00 MUSD invoice; buyer paid it and server verified exact Transfer event and invoice status `paid`. Transaction `0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868`.
- x402 client signed and paid the `$0.001 MUSD` resource through the Mezo facilitator; resource returned HTTP 200 after successful settlement. Transaction `0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c`. Required Permit2 allowance was limited to exactly `0.001 MUSD`.
- Both payment flows credited the same merchant receiver: buyer's remaining MUSD `1798.999`, receiver balance `1.001 MUSD` at verification.
- A previously user-approved `0.000001 BTC` self-transfer was confirmed at block `16371393`; see [Mezo test results](./hackathons/mezo/TEST_RESULTS.md).

## Current validation

- `npm test`: 24 passing, 0 failing.
- `node --check public/app.js`, TypeScript build, and production dependency audit (0 advisories) pass.
- Refreshed app serves the authenticated merchant workspace and returns configured x402 resource settings.
- x402 HTTP check returns 402 with `eip155:31611`, official MUSD contract, exact `0.001 MUSD`, and separate merchant recipient.
- Full invoice lifecycle test reached `paid` after server-side receipt and Transfer-event verification.
- Full x402 payment returned HTTP 200 only after facilitator settlement; settlement receipt succeeded on chain.
- Browser workspace now shows the integrated invoice and agent-product flows with a custom RelayGuard SVG mark; local browser verified authenticated view and no auth form/PII while signed in.

## Not implemented / blockers

- Mezo Testnet invoice and x402 payments are verified, but browser-wallet signing has not been manually tested. Testnet loan has an active trove; 0.045 BTC collateral remains locked under Mezo liquidation rules.
- Supabase Auth is configured and the owner confirms login works. Database migration push timed out, so auth-protected data is still in local SQLite rather than Supabase Postgres.
- Service binds to loopback. No public deployment, rate limiting, production key management, or production threat-model sign-off. Do not expose it publicly.
- No public deployment URL or final hackathon submission verification is configured.
- Solana x402, NEAR, and Lightning integrations remain unimplemented.

## Next steps

1. Obtain the database password through Supabase project settings, store it locally in `.env.supabase.local`, and retry migration push.
2. Manually verify connected browser-wallet signing for invoice checkout and x402 with the funded buyer.
3. Move invoice, authorization, and audit persistence to hosted Postgres; apply and verify the Supabase migration.
4. Configure a deployment target, HTTPS, production callback/origin settings, monitoring, rate limits, and safe signing operations before publishing a public URL.
