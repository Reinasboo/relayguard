# Technical implementation and release notes

One TypeScript/Express application serves the browser workspace and HTTP API. SQLite supports local use. `DATABASE_URL` selects Postgres. Supabase authenticates accounts. Vercel imports the same app through `api/[...path].js`.

| Boundary | Source | Behavior |
|---|---|---|
| Exact policy | `src/core/policy.ts` | Integer units, agent/network/asset/recipient checks, transaction/daily caps |
| Authorization | `src/core/authorization.ts`, `src/core/postgres.ts` | Durable state, idempotency, reservations, approval binding, hash-linked audit |
| Merchant invoices | `src/core/checkout.ts`, `src/server.ts` | Receiving-wallet snapshot, lifecycle, exact receipt matching |
| Buyer proof | `src/core/checkout-security.ts` | Expiring signed challenge binds payer, invoice and attempt. Session capability binds submit/release |
| Operator role | `RELAYGUARD_OPERATOR_USER_IDS` in `src/server.ts` | Explicit Supabase user allowlist. Merchant sign-in grants no treasury access |
| Mezo transfer | `src/adapters/mezo.ts` | BTC value checks and MUSD Transfer-event evidence |
| Mezo risk | `src/mezo/trove-health.ts` | Pinned TroveManager/PriceFeed reads, 110% minimum, 150% app buffer |
| Buyer preflight | `src/mezo/checkout-client.ts` | MUSD/BTC balances, transfer gas, optional reviewed Testnet borrowing |
| x402 | `src/x402/client.ts`, `src/x402/express.ts` | Exact Permit2 authorization and facilitator settlement |
| Reviewer route | `src/mezo/review.ts`, `public/review.*` | Live canonical-contract checks, historical event verification, controlled policy preview |

## Checkout recovery

The buyer signs an invoice-bound ownership challenge before reservation. The API issues an authorization-bound capability for submit/release. Rejecting a wallet request cancels that attempt. A new challenge supplies a new attempt ID, so the same buyer can retry.

A competing invoice reservation cancels only its newly created authorization, releasing its spending reservation. Submission persists the broadcast hash on the invoice before advancing authorization. Retried submit and verify reconcile interrupted transitions. A confirmed authorization with an unfinished invoice update can settle that invoice on the next verify.

These are repairable transitions across separate storage transactions, not a claim of distributed atomicity. Full Postgres concurrency and failure-injection tests require a dedicated configured database. A reserved invoice still needs operational handling if a buyer abandons it without release. Do not expire a broadcast payment or encourage duplicate payment to clear a reservation.

## Access controls

Set `RELAYGUARD_OPERATOR_USER_IDS` to the Supabase UUIDs allowed to use the shared operator signer. The default is empty and denies treasury controls to all accounts. It does not affect merchant wallet verification or invoice creation.

Apply `20261104000000_restrict_wallet_verification.sql` before deployment. It removes browser insert/update access to wallet-attestation fields. Owner RLS alone did not protect those columns.

Set an independent 32+ character `RELAYGUARD_CHECKOUT_SECRET` for operational separation. Otherwise the application derives a key from its configured signer. Secret rotation invalidates active checkout capabilities. Never log capability tokens.

The public invoice lookup omits the merchant's Supabase user ID and internal authorization ID. Human-readable API amounts reject excess decimal precision instead of rounding a charge. MUSD operations require the canonical Mezo Testnet token.

## Mezo evidence

The reviewer verifies chain ID 31611, canonical MUSD bytecode/symbol/decimals, and known historical Transfer events against exact payer, merchant and amount. A relayed x402 receipt is matched against the event payer, not the facilitator's outer transaction sender. Missing RPC receipts are unverified, not inferred successful from a saved hash.

Official references checked November 4, 2026:

- [Mezo contracts](https://testnet.mezo.org/docs/users/resources/contracts-reference)
- [MUSD development guide](https://testnet.mezo.org/docs/developers/musd/)
- [Mezo x402 quickstart](https://testnet.mezo.org/docs/developers/getting-started/musd-payments-x402/x402-quickstart/)

## Reproduce

```powershell
npm ci
npm test
npm run review
# Open http://127.0.0.1:4173/review
```

Reviewer mode needs no private key, account, database credentials or funds. It disables merchant/payment mutations and paid x402. It reads public Mezo data and runs controlled policy examples.

```powershell
npm run verify:ui
```

The UI script uses Chrome and Playwright to capture desktop/mobile screenshots, four policy states, an amount-cap check, default merchant navigation, and denied mutations in reviewer mode.

It also runs an unrecorded mocked-wallet regression for a reload after broadcast: the stored transaction hash is reconciled without calling the wallet again. This is test coverage, not live settlement footage.

Submission artifact rebuilding on this Windows workspace:

```powershell
python -m pip install reportlab pymupdf pillow
python scripts/generate-submission.py
python scripts/render-walkthrough.py
powershell -NoProfile -File scripts/narrate-pitch.ps1
python scripts/render-pitch.py
```

FFmpeg and Chrome must be installed. The stock narration uses the local Microsoft David voice. Keep its disclosure visible, or replace it with a founder recording. Source text and all artifact generators remain editable.

## Deployment order

The current source is deployed; Vercel reports it ready and `/review` plus the submission PDF returned HTTP 200. This is not release acceptance: the production spot check found the operator allowlist and checkout secret are absent, and the x402 endpoint returned 502 after a facilitator timeout. Complete the remaining gates in the [release checklist](RELEASE_CHECKLIST.md).

1. Back up the database and apply the new forward migration.
2. Configure operator UUIDs and checkout secret in the deployment environment.
3. Recheck `/review`, static assets, account roles, invoice retry and a valid x402 challenge after configuration.
4. Repeat the buyer checkout on a second device with a real wallet and approved Testnet funds.
5. Add the actual hosted video and deployed-revision links to the submission.

Mainnet operation additionally needs signer custody, shared rate limits, monitoring, backups and independent review. Solana, NEAR and Lightning foundations are outside this Mezo Wave 2 claim.
