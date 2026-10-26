# Build status

Updated: 2026-10-26

## Product

RelayGuard combines **MUSD merchant checkout and x402 paid resources** in one Mezo product. Merchants can accept QR invoices from people or publish a protected HTTP resource that agents unlock by paying MUSD. Both routes pay the same merchant wallet; merchant/operator controls use Supabase Auth. See the [Mezo product strategy](./hackathons/mezo/PRODUCT_STRATEGY.md).

## Implemented

- Deterministic integer-based spending policy, idempotency, approval challenges, constrained lifecycle transitions, and hash-linked audit events.
- SQLite persistence for local authorization, audit, and checkout invoice state; startup fails closed if audit-chain verification fails. Vercel runtime implementations use Supabase Postgres, with atomic per-agent spend reservations and a serialized hash-chain head.
- Versioned typed adapter contract and registry. Mezo supports native BTC and testnet MUSD; Solana x402, NEAR, and Lightning remain fail-closed adapter foundations.
- Local Mezo Testnet console and API for wallet/network status, policy review, explicit operator execution, receipt verification, and audit evidence.
- Merchant workspace, durable MUSD invoices, expiry and reservation controls, shareable checkout URLs, locally generated QR codes, and direct buyer-wallet signing.
- Browser x402 EVM client and Express payment middleware for a `$0.001 MUSD` protected resource on Mezo Testnet. Mezo facilitator capability sync succeeds; unpaid HTTP requests return 402 with the expected canonical MUSD token, amount, recipient, and chain ID.
- Supabase CLI 2.122.0 authenticated and linked to project `relayguard`; both hosted migrations applied and verified. Email Auth provider enabled, local callback URLs allowlisted, publishable key configured in ignored local app config. Merchant invoices are user-ID scoped; operator audit/payment endpoints require a verified Supabase bearer token.
- Separate merchant wallet generated and stored in ignored `.env.wallets.local`; buyer/operator wallet retained separately. No wallet key was committed or printed as output.
- Vercel function entry point and deployment config are built. All required production environment variable names are configured; live read-only Supabase Postgres readiness and audit-chain checks pass. No deployment has been published yet.
- Invoice authorization binds the payer, merchant, exact MUSD amount, and policy record. Settlement requires a matching successful MUSD `Transfer` event and exact sender, recipient, and amount before the invoice becomes paid.
- Checkout rejects insufficient MUSD before reserving an invoice. Wallet rejection can release an unsubmitted authorization; malformed transaction hashes are rejected before state transitions.
- User-authorized minimum MUSD testnet borrow executed through official `BorrowerOperations`: 1,800 MUSD against 0.045 BTC collateral; receipt verified.
- Authenticated merchant created a 1.00 MUSD invoice; buyer paid it and server verified exact Transfer event and invoice status `paid`. Transaction `0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868`.
- x402 client signed and paid the `$0.001 MUSD` resource through the Mezo facilitator; resource returned HTTP 200 after successful settlement. Transaction `0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c`. Required Permit2 allowance was limited to exactly `0.001 MUSD`.
- Both payment flows credited the same merchant receiver: buyer's remaining MUSD `1798.999`, receiver balance `1.001 MUSD` at verification.
- A previously user-approved `0.000001 BTC` self-transfer was confirmed at block `16371393`; see [Mezo test results](./hackathons/mezo/TEST_RESULTS.md).

## Current validation

- `npm test`: 26 passing, 0 failing; TypeScript build/typecheck and `vercel build --prod --yes` pass.
- `node --check public/app.js`, TypeScript build, and production dependency audit (0 advisories) pass.
- Refreshed app serves the authenticated merchant workspace and returns configured x402 resource settings.
- x402 HTTP check returns 402 with `eip155:31611`, official MUSD contract, exact `0.001 MUSD`, and separate merchant recipient.
- Full invoice lifecycle test reached `paid` after server-side receipt and Transfer-event verification.
- Full x402 payment returned HTTP 200 only after facilitator settlement; settlement receipt succeeded on chain.
- Browser workspace now shows the integrated invoice and agent-product flows with a custom RelayGuard SVG mark; local browser verified authenticated view and no auth form/PII while signed in.

## Not implemented / blockers

- Mezo Testnet invoice and x402 payments are verified, but browser-wallet signing has not been manually tested. Testnet loan has an active trove; 0.045 BTC collateral remains locked under Mezo liquidation rules.
- Supabase Auth is configured and the owner confirms login works. The Postgres runtime connects to the hosted database and verifies checkout schema access and the audit chain; local development remains on SQLite.
- A Vercel project and GitHub auto-deploy connection are configured, and production variables are present. No public deployment has been published; rate limiting, production key management, and production threat-model sign-off remain open.
- No public deployment URL or final hackathon submission verification is configured.
- Solana x402, NEAR, and Lightning integrations remain unimplemented.

## Next steps

1. Publish the verified Vercel production build and smoke-test public and protected routes.
2. Add the production Vercel origin to Supabase Auth redirect URLs and manually verify browser-wallet signing for invoice checkout and x402.
3. Add rate limits and operational safeguards before treating the app as production-ready.
