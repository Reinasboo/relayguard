# RelayGuard

RelayGuard is one Mezo MUSD payments product with two connected experiences: QR-ready merchant invoices for people and an x402-protected paid resource for software agents. Buyers use their own EVM wallet; merchants receive MUSD directly. The operator console brings authorization, limits, and settlement evidence together.

## Current status

The repository contains a working Mezo Testnet product demo with verified invoice and x402 settlements. A public deployment is not configured yet. It includes:

- Exact integer/base-unit policy checks for agent, network, asset, recipient, transaction cap, daily cap, and approval threshold.
- A SQLite-backed authorization lifecycle with per-agent idempotency, atomic daily reservations, expiring approvals bound to the intent and policy version, and a hash-linked audit log.
- A versioned adapter interface and Mezo testnet integration for native BTC transfers and optional MUSD ERC-20 transfers.
- A durable MUSD merchant invoice book with expiry, shareable checkout URL, generated QR code, direct buyer-wallet signing, authorization binding, and matching ERC-20 settlement verification.
- An integrated x402 API paid in MUSD on Mezo Testnet, using the Mezo facilitator and a browser EIP-712 wallet flow. Unpaid requests return x402 payment requirements; the resource is unlocked only after facilitator settlement.
- Supabase Auth-backed merchant sign-in for invoice creation/history and operator audit/payment APIs; each merchant's local invoice history is scoped to their authenticated Supabase user.
- A local-only browser console and HTTP API for intent review, policy decisions, human approval, explicit execution, settlement verification, and audit evidence.
- Focused automated tests for policy limits, approval binding, idempotency, lifecycle transitions, and audit-chain integrity.

The Mezo-specific product direction and evidence are in the [merchant checkout strategy](./docs/hackathons/mezo/PRODUCT_STRATEGY.md). The Solana, NEAR, and Lightning adapters remain fail-closed foundations. The Mezo borrower opened a testnet trove, then completed a 1.00 MUSD invoice and a 0.001 MUSD x402 payment to the same merchant receiver; on-chain receipts are recorded in the [test results](./docs/hackathons/mezo/TEST_RESULTS.md). This is not a public deployment: SQLite stores authorization and invoice state, and cross-device browser-wallet signing still needs validation.

## Requirements

- Node.js 22 or newer
- npm

## Local development

```powershell
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173`. `npm start` builds the TypeScript server and starts the local console. `npm test` compiles TypeScript and runs the Node test suite; `npm run typecheck` runs TypeScript without emitting build output.

Copy `.env.example` to `.env`, then set `MEZO_PRIVATE_KEY`, the matching `MEZO_SIGNER_ADDRESS`, `MEZO_MERCHANT_ADDRESS`, and a comma-separated `MEZO_ALLOWED_RECIPIENTS` allowlist containing the merchant. Leave the network set to `testnet`. The server checks that `MEZO_TOKEN_ADDRESS` has deployed code and reports the `MUSD` symbol. Keep `.env` private. Local ignored `.env.app.local` holds the Supabase publishable key and demo merchant address; `.env.wallets.local` holds the newly generated merchant wallet key. Never copy these files into a public deployment or expose wallet keys.

Supabase CLI authentication and project linking are set up for project `relayguard`. The Auth email provider is enabled, and local redirect URLs point at port 4173. The merchant app uses Supabase Auth for sessions, but the SQL migration is **not yet applied**: the linked database connection timed out and needs the database password locally. Add `SUPABASE_DB_PASSWORD=...` to ignored `.env.supabase.local`, then run `.\scripts\supabase.ps1 db push --linked`. The deploy migration enables row-level security and private merchant invoice access. Until it is applied and the runtime repository is moved to hosted Postgres, application invoice/audit persistence remains SQLite.

The x402 resource is available at `/api/paid-resource`, priced at `$0.001` MUSD on `eip155:31611`, and pays to the generated merchant wallet. The integrated UI and `/api/config` expose only the publishable Supabase key; there is no service-role key in the browser or application configuration.

The merchant tool creates MUSD invoices. Buyers pay through a connected EVM wallet, which signs the exact invoice transfer; direct checkout needs MUSD and BTC for gas. The x402 flow asks the Mezo facilitator to settle a signed MUSD authorization and sponsor settlement gas. The browser checks Permit2 allowance and requests an exact MUSD approval when needed; that approval transaction uses BTC for gas. The verified x402 demo used a narrowly scoped 0.001 MUSD allowance. Mezo's [official guide](https://mezo.org/docs/users/borrow/mint-musd/) documents the minimum loan and collateral requirements; the demo borrower currently has an active testnet trove. SQLite stores invoices and authorizations. Checkout settlement requires a matching ERC-20 `Transfer` event and exact sender, recipient, and amount.

## Architecture direction

One shared authorization core will sit before protocol-specific adapters. An adapter advertises only capabilities it actually implements; the core must not infer that authorization means execution or that submission means settlement. The detailed target boundaries and staged implementation sequence are in [docs/architecture/overview.md](./docs/architecture/overview.md).

## Security and limitations

The `AuthorizationService` uses SQLite transactions (`BEGIN IMMEDIATE`) and a durable database file; separate SQLite connections serialize authorization decisions and daily reservations. Operator controls and merchant invoice listing/creation require a verified Supabase user token. Hash-linked audit events are not independently tamper-proof against an administrator able to rewrite the database. There is no production signing boundary, rate limiting, managed database persistence, or public deployment. Keep the server loopback-only until the remaining deployment checklist is complete.

`.env.example` contains only placeholders and safe defaults. Do not expose the current service publicly or authorize real funds until hosted persistence, production signing controls, and a production deployment review are complete.
