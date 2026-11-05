# RelayGuard

**Current Wave 2 submission:** [submission package](docs/hackathons/mezo/wave2/SUBMISSION.md), [technical brief](docs/hackathons/mezo/wave2/TECHNICAL.md), [demo, seven submission images and PDF](docs/hackathons/mezo/wave2/ARTIFACTS.md), and [release checklist](docs/hackathons/mezo/wave2/RELEASE_CHECKLIST.md).

The [visual system](docs/hackathons/mezo/wave2/VISUAL_SYSTEM.md) follows the owner's [design rules](design.md). Shared primitives and page layouts have separate ownership; review screenshots cover 50 populated, empty and error states across phone, tablet and desktop widths.

Review the new product walkthrough without keys, accounts or funds:

```powershell
npm ci
npm run review
# http://127.0.0.1:4173/review
```

For the normal payment application, configure `.env` as described below. Shared treasury APIs require the signed-in user's Supabase UUID in `RELAYGUARD_OPERATOR_USER_IDS`; merchant sign-in alone does not grant operator permission. The current source revision is deployed and Vercel reports it ready, but release acceptance is still blocked on the November 4 wallet-verification migration and production operator/checkout configuration. See the [release checklist](docs/hackathons/mezo/wave2/RELEASE_CHECKLIST.md) before relying on production merchant or treasury flows.

RelayGuard is one Mezo MUSD payments product with two connected experiences: QR-ready merchant invoices for people and an x402-protected paid resource for software agents. Buyers use their own EVM wallet; merchants receive MUSD directly. The operator console brings authorization, limits, and settlement evidence together.

## Historical baseline before the November 4 revision

The details below are a November 3 snapshot, not the current release checklist or deployment state. Current source, validations, and remaining production gates are tracked in the [Wave 2 submission](docs/hackathons/mezo/wave2/SUBMISSION.md), [validation report](docs/hackathons/mezo/wave2/VALIDATION.md), and [release checklist](docs/hackathons/mezo/wave2/RELEASE_CHECKLIST.md).

The repository contains a working Mezo Testnet product demo with verified invoice and x402 settlements, a Vercel serverless entry point, and Supabase Postgres persistence. The public app is deployed at [relayguard.vercel.app](https://relayguard.vercel.app); API, health, config, x402 challenge, checkout routing, and the live trove-health dashboard have been smoke-tested. A previous QR routing issue has been fixed, but a fresh authenticated invoice-to-wallet-payment pass is still outstanding. It includes:

- Exact integer/base-unit policy checks for agent, network, asset, recipient, transaction cap, daily cap, and approval threshold.
- A storage-backed authorization lifecycle with per-agent idempotency, atomic daily reservations, expiring approvals bound to the intent and policy version, and a hash-linked audit log that commits Mezo policy and trove evidence digests. Local development uses SQLite; Vercel uses hosted Postgres.
- A versioned adapter interface and Mezo testnet integration for native BTC transfers and optional MUSD ERC-20 transfers.
- A durable MUSD merchant invoice book with expiry, shareable checkout URL, generated QR code, direct buyer-wallet signing, authorization binding, and matching ERC-20 settlement verification.
- An Express x402 adapter merchants can add to their own Node.js API to protect website routes and paid resources; the merchant retains its storefront, server, response, and verified MUSD payout destination. The adapter is currently source code, not a published npm package or browser checkout widget.
- An integrated x402 API paid in MUSD on Mezo Testnet, using the Mezo facilitator and a browser EIP-712 wallet flow. Unpaid requests return x402 payment requirements; the resource is unlocked only after facilitator settlement.
- A read-only Mezo MUSD trove health check that gates automated MUSD spending: human approval below RelayGuard's 150% review buffer, a hard stop below Mezo's 110% minimum, and fail-closed behavior when protocol reads are unavailable.
- Supabase Auth-backed merchant sign-in for invoice creation/history and operator audit/payment APIs; each merchant's local invoice history is scoped to their authenticated Supabase user.
- A browser console and HTTP API for intent review, policy decisions, human approval, explicit execution, settlement verification, and audit evidence; local development remains loopback-only.
- Block-pinned Mezo trove snapshots attached to MUSD authorization decisions and human approvals, with stale-policy cancellation and tamper-detection coverage.
- Focused automated tests for policy limits, trove risk tiers, approval binding, idempotency, lifecycle transitions, and audit-chain integrity.

The Mezo-specific product direction and evidence are in the [merchant checkout strategy](./docs/hackathons/mezo/PRODUCT_STRATEGY.md). The Solana, NEAR, and Lightning adapters remain fail-closed foundations. The Mezo borrower opened a testnet trove, then completed a 1.00 MUSD invoice and a 0.001 MUSD x402 payment to the same merchant receiver; on-chain receipts are recorded in the [test results](./docs/hackathons/mezo/TEST_RESULTS.md). At the time of this historical snapshot, three hosted migrations, the Vercel deployment, and live health/Postgres startup had been verified. The current candidate adds further release gates; its latest automated suite passes 63 tests. Historical transactions are not current production-readiness evidence.

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

Supabase CLI authentication and project linking are set up for project `relayguard`. The Auth email provider is enabled, production and local redirect URLs are configured, and all three hosted database migrations have been applied. Local development still uses SQLite. The Vercel runtime selects hosted Postgres when `DATABASE_URL` is configured and fails closed if it is absent. The transaction-pooler connection uses encrypted TLS per Supabase's serverless guidance; use the Supabase database CA certificate to enable certificate verification where required. Never put credentials in source control or chat.

The x402 resource is available at `/api/paid-resource`, priced at `$0.001` MUSD on `eip155:31611`, and pays to the generated merchant wallet. The integrated UI and `/api/config` expose only the publishable Supabase key; there is no service-role key in the browser or application configuration.

The merchant tool creates MUSD invoices. Buyers pay through a connected EVM wallet, which signs the exact invoice transfer; direct checkout needs MUSD and BTC for gas. The x402 flow asks the Mezo facilitator to settle a signed MUSD authorization and sponsor settlement gas. The browser checks Permit2 allowance and requests an exact MUSD approval when needed; that approval transaction uses BTC for gas. The verified x402 demo used a narrowly scoped 0.001 MUSD allowance. Mezo's [official guide](https://mezo.org/docs/users/borrow/mint-musd/) documents the minimum loan and collateral requirements; the demo borrower currently has an active testnet trove. SQLite stores invoices and authorizations. Checkout settlement requires a matching ERC-20 `Transfer` event and exact sender, recipient, and amount.

## Architecture direction

One shared authorization core will sit before protocol-specific adapters. An adapter advertises only capabilities it actually implements; the core must not infer that authorization means execution or that submission means settlement. The detailed target boundaries and staged implementation sequence are in [docs/architecture/overview.md](./docs/architecture/overview.md).

## Security and limitations

Local `AuthorizationService` uses SQLite transactions (`BEGIN IMMEDIATE`); the hosted implementation uses Postgres transactions, per-agent advisory locks for spending reservations, and a serialized audit-chain head. The payment workspace publicly shows read-only status for the operator-configured signer, including its Mezo Testnet balances and trove metrics; these are not a visitor’s or merchant’s wallet. `GET /api/health` returns readiness and network metadata, while `GET /api/health/console` returns curated public operator status without recipient allowlists or configured spending limits. `GET /api/health/details`, payment controls, and protected spending configuration require an authenticated user. The separate multi-tenant merchant workspace scopes profiles, verified payout wallets, invoices, and x402 resources to each signed-in merchant. Hash-linked audit events are not independently tamper-proof against a database administrator. Rate limiting, dedicated production signing controls, and production deployment review remain outstanding.

`.env.example` contains only placeholders and safe defaults. The public deployment is a Mezo Testnet demo, not a mainnet-ready payment service. Do not authorize real funds until production signing controls, operational hardening, and a production-readiness review are complete.
