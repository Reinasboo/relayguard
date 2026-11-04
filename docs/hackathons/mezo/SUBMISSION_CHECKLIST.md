# Mezo Submission Checklist

> Historical checklist from the earlier submission iteration. Use the [current Wave 2 release checklist](./wave2/RELEASE_CHECKLIST.md) for this candidate; its latest local validation reports 63 passing tests.

- [x] Integrate Mezo Testnet MUSD and verify the documented token contract on-chain.
- [x] Open the minimum-size testnet MUSD trove, verify the successful receipt, wallet balance, debt, collateral, and collateral ratio. Transaction: `0x0175798b2aeaf7486d348a3e8194fe61c52570fe8bd8849b235041f39df1ceee`.
- [x] Build a merchant MUSD invoice, shareable checkout URL, QR code, buyer wallet path, and receipt-based payment status.
- [x] Add integrated x402 MUSD protected-resource path using the Mezo Testnet facilitator and a browser typed-data wallet client.
- [x] Configure Supabase Auth and protect merchant invoice management plus operator audit/payment APIs with verified user sessions.
- [x] Generate a distinct merchant receiving wallet and keep its private key in ignored local storage.
- [x] Test invoice creation, QR image delivery, buyer zero-balance rejection, invoice remains open, and malformed-hash rejection against the local API.
- [x] Complete a 1.00 MUSD invoice payment, match its transfer event, and transition the invoice to `paid`: `0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868`.
- [x] Verify unpaid x402 requests return HTTP 402 with the canonical testnet MUSD token, exact `0.001 MUSD` price, Mezo Testnet chain ID, and merchant recipient.
- [x] Run automated tests: 45 passing; TypeScript and browser syntax checks pass.
- [x] Include the verified native BTC testnet transaction hash and receipt, clearly distinguished from MUSD checkout.
- [x] Install Supabase CLI, authenticate, link the `relayguard` project, and successfully preview the database migration. Auth redirect URLs configured.
- [x] Apply the RLS-protected merchant profile and invoice migration to the linked Supabase project and verify remote migration history.
- [x] Add and apply hosted authorization/audit storage schema; add Vercel serverless API and Postgres repository implementations.
- [x] Owner confirmed merchant account sign-in works.
- [x] Complete a live testnet buyer invoice payment and verify the invoice state and matching on-chain receipt.
- [x] Complete an x402 facilitator settlement with a funded test buyer and verify transaction evidence: `0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c`.
- [x] Make the browser x402 client check Permit2 allowance, request only the exact MUSD approval when required, and verify its successful receipt and resulting allowance.
- [ ] Manually verify browser-wallet signing in the merchant checkout and x402 UI with the demo buyer account.
- [x] Configure the pooled Postgres URL and required Mezo/Supabase settings in Vercel; verify production build and live database readiness.
- [x] Deploy the public Vercel app and verify health/config, x402 challenge, checkout routing, and hosted Postgres readiness.
- [x] Configure Supabase Auth redirect URLs for the production origin.
- [ ] Complete an authenticated production invoice, QR scan, wallet signature, and receipt-verification pass from a second device.
- [x] Deploy trove-aware MUSD controls and bounded verification states; live healthy-trove display is confirmed.
- [x] Pin Mezo trove reads to one block and retain policy evidence for request, approval, and execution checks.
- [x] Bind policy/evidence digests into the hash-linked audit trail for SQLite and Postgres; apply the forward migration.
- [x] Protect cancellation with the operator session guard and let operators cancel stale pending approvals.
- [x] Cover policy behavior at exact review/block thresholds and invalid PriceFeed/RPC failure paths with controlled automated tests.
- [x] Add buyer-side MUSD/BTC balance and transfer-gas preflight before invoice authorization.
- [x] Add optional, explicitly reviewed Mezo Testnet trove opening for eligible underfunded buyers; keep borrowing and invoice payment as separate transactions.
- [x] Improve frontend loading, retry, and stale-request behavior; validate with 45 automated tests and delayed local API mocks.
- [x] Read-only preflight a user-connected Testnet wallet; confirm the optional borrow correctly refuses insufficient collateral, with no signature or transaction submitted.
- [ ] Manually verify the new checkout preflight and optional BorrowerOperations flow in a browser wallet using a separate funded Testnet account; do not broadcast a borrow transaction without explicit approval.
- [ ] Finish production operational hardening: rate limits, monitoring, backups, route-by-route operator review, and key custody.
- [ ] Validate final buildathon rules, submission format, and demo reproducibility.
