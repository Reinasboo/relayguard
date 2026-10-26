# Mezo Deployment

## Integrated testnet demo

1. Use Node.js 22.5+ and run `npm install`.
2. Set `MEZO_PRIVATE_KEY` and `MEZO_SIGNER_ADDRESS` in ignored `.env`. This is the already-funded Mezo Testnet operator/buyer wallet; never use a mainnet key.
3. The workspace-local `.env.app.local` configures the Supabase project publishable key, a separate merchant address, `X402_ENABLED=true`, and a `$0.001` x402 price. `.env.wallets.local` holds the generated merchant wallet private key. Both files are ignored by Git.
4. Run `npm test`, then `npm start`, and open `http://127.0.0.1:4173/#merchant`.
5. Sign in/create an account in the Supabase merchant panel. New accounts may require email confirmation. Merchant invoice creation/history and operator audit/payment APIs require a valid Supabase session.
6. Create a MUSD invoice to demonstrate the QR/human checkout path. Buyers connect their wallet and pay directly.
7. Use the integrated x402 panel or `GET /api/paid-resource` to demonstrate the agent path. An unpaid request should return HTTP 402 with Mezo Testnet MUSD payment requirements; the browser client checks and, if required, requests the exact Permit2 allowance before the buyer signs authorization. The approval transaction uses BTC for gas; the facilitator settles the MUSD payment.

The app currently binds to loopback and stores invoice/authorization/audit data in SQLite. It is a testnet demo, not a public production service. A checkout QR is only reachable from this machine.

## Vercel deployment assessment

Vercel CLI `65.2.0` is installed and authenticated, and the `relayguard` project is created, linked, and connected to the GitHub repository. A static-only deployment of `public/` is not a working RelayGuard deployment: the browser app requires same-origin `/api/config`, `/api/health`, invoice, authorization, and x402 routes, while checkout links must resolve to server-side invoice state. Those routes currently run in the local Express server and use SQLite; no public API origin or deployment is configured.

Vercel can host the frontend once a reachable API and durable database are available. Do not deploy the current UI as if checkout were live, or expose the local SQLite server as a public API. First choose and configure a production API/persistence architecture, then connect the Vercel frontend to that API and test invoice creation, buyer checkout, and x402 settlement on the deployed origins.

## Supabase CLI, Auth, and database

- Supabase CLI `2.122.0` runs through `npx supabase`, and local project metadata points to the Supabase project `relayguard`. The CLI is not authenticated in the current environment; re-authenticate before inspecting or applying remote migrations.
- The Supabase email provider is enabled and local callback URLs (`127.0.0.1:4173` and `localhost:4173`) are allowlisted.
- The publishable client key is local-only in `.env.app.local`. No service-role key is installed or used by browser code.
- `supabase/migrations/20261026000000_relayguard_checkout_auth.sql` defines RLS-protected merchant profiles and invoices. A dry-run succeeded, but applying it timed out while connecting to the remote database.
- To retry, add `SUPABASE_DB_PASSWORD=...` to ignored `.env.supabase.local`, then run `.\scripts\supabase.ps1 db push --linked`. Never put the password or PAT into chat or source control.
- Even after migration, the server still needs a Supabase/Postgres invoice repository before it can claim hosted persistence. Current records remain in SQLite.

## Wallet state and payment evidence

- Buyer/operator wallet: `0x2D6d690df41807910826e799A34D7fB418480828`, Mezo Testnet chain ID `31611`. It opened a testnet trove with `0.045 BTC` collateral and borrowed `1,800 MUSD`; approximately `0.005 BTC` remains liquid.
- The opening loan has a `1.8 MUSD` issuance fee and `200 MUSD` gas compensation, for `2,001.8 MUSD` opening debt before ongoing interest. This is a testnet loan against testnet BTC; the trove remains active and collateralized.
- Merchant receiver: `0x840E5bBF20D725f581752f8A4021ADd730550d47`, received `1.00 MUSD` from the invoice test and `0.001 MUSD` from x402. Its private key remains in ignored `.env.wallets.local`.
- The x402 facilitator advertises the official testnet MUSD contract `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`. The local paid route returns a 402 with the correct 0.001 MUSD amount and generated merchant recipient.
- Borrow transaction confirmed: `0x0175798b2aeaf7486d348a3e8194fe61c52570fe8bd8849b235041f39df1ceee`. See [test results](./TEST_RESULTS.md) for receipt, current debt/collateral, ratio, and costs.
- Invoice payment confirmed: `0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868`; x402 facilitator settlement confirmed: `0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c`.
- x402 required Permit2 token approval. The approval was exactly `0.001 MUSD`, not unlimited; tx: `0xe5ca4098ac03da35d7cedbbd76389a2bba0280d988d97636a5086a6ea075d20a`.
- The previously confirmed BTC self-transfer proves the native testnet adapter only. See [test results](./TEST_RESULTS.md).

## Public deployment gate

Do not point a public host at the current server. Before deployment, move invoices, authorizations, and audit events to hosted PostgreSQL with the prepared RLS policies; finish role/profile onboarding; review operator authorization on every route; configure HTTPS, a production origin/redirect allowlist, rate limits, backups, monitoring, and test-only key custody. The funded invoice and x402 settlement have been completed on testnet; cross-device browser wallet verification and the public deployment remain outstanding. No public host or deployment URL is configured.
