# Product upgrade: Mezo MUSD Merchant Checkout

> Product rationale and implementation notes from an earlier Wave 2 iteration. The current submission and release state are documented in [wave2/SUBMISSION.md](./wave2/SUBMISSION.md) and [wave2/RELEASE_CHECKLIST.md](./wave2/RELEASE_CHECKLIST.md).

## Why this is the right Mezo problem

RelayGuard's initial version proved the authorization and Mezo receipt path but did not yet make MUSD protocol state part of spending decisions. Wave 2 adds that risk-aware operator policy while preserving direct merchant checkout and x402 settlement.

Mezo's official [Borrow and Mint MUSD guide](https://mezo.org/docs/users/borrow/mint-musd/) says the minimum loan is 1,800 MUSD, with a 200 MUSD gas deposit and at least 2,000 MUSD of opening debt. That is a notable onboarding hurdle for someone who only wants to make or accept a small everyday payment. The same guide lists the official Mezo Testnet MUSD contract and explains how test MUSD is obtained.

## Product

**RelayGuard** connects MUSD merchant acceptance to MUSD-powered software distribution in one product. Each merchant signs in, proves ownership of a Mezo wallet with a one-time signature, and can create MUSD-denominated invoices that settle directly to that wallet. For software agents, a merchant registers a route on their own API, adds the RelayGuard Express x402 adapter to their Node.js backend, and uses a scoped server-side API key. The agent signs x402 payment authorization; the configured facilitator verifies and settles the exact payment directly to that merchant's verified wallet. The current adapter is supplied as source code to copy into a merchant project; it is not yet a published npm package or browser checkout widget.

This is an access-and-distribution product rather than another generic transfer screen:

- Merchants can quote small MUSD amounts without building a wallet connection, token transfer, QR, invoice, or settlement watcher.
- Agents can pay for a protected HTTP resource in MUSD using the x402 protocol, without a custom integration or buyer-side gas transaction.
- Merchants control their own payout destination and API resources; credentials are scoped per resource, stored only as hashes, and can be rotated or revoked.
- The Express adapter obtains each resource's verified destination and price from RelayGuard, then protects the merchant's own route; the merchant keeps ownership of the API response and its application server.
- The customer's wallet remains the signer; RelayGuard does not take custody of the checkout payment.
- The merchant receives MUSD directly; the merchant does not need to borrow MUSD to accept it.
- The checkout page links to Mezo's own MUSD onboarding guidance when a customer has not acquired MUSD.
- The existing agent policy console remains the operator's control plane for treasury and automation flows.

## Implemented flow

1. Merchant signs in, connects a Mezo-compatible wallet, and signs a one-time message proving control of the receiving address.
2. Merchant creates a fixed-amount MUSD invoice with an expiry.
3. RelayGuard stores the invoice durably and returns a shareable link and locally generated QR image.
4. Customer wallet switches to Mezo Testnet and connects from the checkout page.
5. Checkout reads the buyer's MUSD and native BTC balances and estimates direct-transfer gas before requesting invoice authorization. Insufficient MUSD or gas creates no authorization and sends no payment.
6. Customer reviews and signs the direct ERC-20 transfer in their wallet.
7. Backend persists the transaction reference, reads the Mezo receipt, decodes the matching `Transfer` event, and checks sender, recipient, amount, asset, and authorization before marking the invoice paid.
8. If the wallet rejects before broadcast, the authorization is cancelled and the invoice is released. If the wallet broadcasts but the API response fails, the page attempts reconciliation and warns the customer not to pay again.

### Optional buyer trove onboarding (Testnet only)

If a connected buyer is short on MUSD, has no active trove, and the live minimum borrow can cover the shortfall, checkout can present an optional BorrowerOperations flow. It reads current Testnet debt minimums, account fee exemption, borrowing fee, interest rate, PriceFeed, and trove status; estimates collateral using a conservative 200% initial collateral-ratio app target; and estimates/simulates the transaction before wallet review. The buyer must review the quoted debt, fee, collateral, and gas, acknowledge liquidation risk, and confirm the separate transaction in their own wallet. This is not a payment and does not automatically authorize or pay the invoice. Existing troves are not changed; existing borrowers are directed to Mezo's official app. The minimum MUSD borrow is not offered where it cannot cover the invoice shortfall.

The 200% opening target is RelayGuard's conservative interface policy, not a Mezo protocol requirement or a guarantee against liquidation. The buyer still needs native BTC for both collateral and gas. This feature is Testnet-only; browser wallet signing has not yet been manually validated, and no transaction was broadcast as part of this implementation.

The merchant's x402 route uses the facilitator's `exact` scheme at `eip155:31611`. An unpaid request returns a protocol 402 response naming the official MUSD token, exact price, and merchant recipient. An x402-compatible client signs the typed-data authorization; the merchant's route unlocks only after successful facilitator settlement. The merchant management API and Express SDK/adapter are implemented; the adapter is supplied as source code, and this integration is currently Testnet-only.

## Honest demo limitations

- The verified-wallet flow is implemented, but browser wallet signing and merchant-specific settlement still need fresh end-to-end testing against the production deployment.
- The test buyer/operator wallet borrowed 1,800 MUSD and completed both a 1.00 MUSD merchant invoice payment and a 0.001 MUSD x402 resource payment. Both transactions settled to the same merchant receiver and were verified.
- The merchant receiver now holds 1.001 MUSD from those test transactions. These are testnet amounts and transactions, not evidence of mainnet readiness.
- The borrower has an active testnet trove with 0.045 BTC collateral and approximately 2,001.8 MUSD opening debt, including the MUSD gas compensation and issuance fee. This testnet collateral remains subject to the same protocol liquidation rules; do not use a mainnet wallet for a demo.
- The latest source is deployed at [relayguard.vercel.app](https://relayguard.vercel.app), and Vercel reports the deployment ready. A ready deployment does not establish that production flows are fully configured or validated.
- Local development defaults to `127.0.0.1` and SQLite. Production runtime requires `DATABASE_URL`.
- The current [release checklist](./wave2/RELEASE_CHECKLIST.md) records the still-pending wallet-verification migration and missing operator/checkout production variables. A November 4 spot check also received HTTP 502 from the x402 route after the facilitator supported request timed out; retry before treating the endpoint as available.
- The previously completed BTC transaction proves the Mezo execution/receipt path only; it is not MUSD checkout evidence.

## Wave 2: protocol-aware spending policy

The MUSD agent-payment policy now reads the operator's Mezo Testnet trove status, current BTC/USD price, and current individual collateral ratio from the MUSD protocol before authorizing, approving, or executing an MUSD payment. The ICR is calculated by the protocol's `TroveManager.getCurrentICR` view, not reconstructed from a UI estimate.

- At or above 150% ICR, the configured MUSD transaction and daily limits apply.
- From 110% up to (but not including) 150% ICR, every positive MUSD payment requires an explicit human approval.
- Below Mezo's 110% minimum collateral ratio, MUSD authorization, approval, and execution are blocked.
- If the live protocol read fails, MUSD authorization, approval, and execution fail closed. BTC payments remain governed by their existing policy.
- All relevant contract reads use one captured block number. Authorization records retain the price, borrower, risk tier, ICR, collateral, debt, block, and observation time; the audit chain commits the policy and evidence digests.
- Approval is bound to the original risk-tier policy. If the risk tier changes, approval/execution stop and the pending request can be cancelled; authorized humans may still reject a stale request.
- The dashboard displays the observed trove status, ICR, collateral, and debt. A signer with no active trove can still use the standard MUSD limits; this feature does not force users to open a loan or add collateral.
- These controls are for RelayGuard's configured operator signer and its agent-payment authorization routes. They do not monitor each checkout payer's personal trove or gate the merchant invoice and x402 settlement flows, which remain separate exact MUSD payments.
- The trove-aware policy, block-pinned evidence, audit commitments, cancellation recovery, bounded checkout retry/loading states, buyer-side preflight, and optional Testnet trove onboarding are deployed. All 49 automated tests pass, including controlled policy boundaries and RPC failures. A production browser mock confirmed QR rendering and the underfunded checkout state; real browser-wallet testing, a valid production invoice QR, and live production threshold manipulation remain outstanding.

The reserve and review thresholds are RelayGuard policy choices, not Mezo protocol parameters. The 110% minimum is the protocol's stated minimum collateral ratio. Testnet contract reads may be unavailable; in that case, the dashboard reports the state as unavailable and MUSD policy actions remain paused.

## Proposed revenue model and milestones

The proposed model is a free pilot followed by a $19/month merchant workspace subscription and a 0.5% fee on successfully settled MUSD invoices. These are unvalidated pricing hypotheses; billing and platform-fee collection are not implemented. Checkout currently settles directly to the configured merchant receiver.

Proposed milestones:

1. **November 10, 2026:** complete a controlled production-policy validation for healthy, review, below-minimum, and unavailable-RPC decisions; keep any below-minimum test isolated from real-value operations.
2. **November 17, 2026:** complete a second-device merchant QR checkout from invoice creation through a verified Mezo receipt.
3. **December 1, 2026:** interview three pilot merchants and report invoice completion, agent resource access, settlement time, and support outcomes.

These dates and pilot targets are proposals, not confirmed commitments.

## Next buildathon-ready steps

1. Verify the deployed policy thresholds using a controlled test strategy and capture auditable decision evidence.
2. Complete a fresh buyer wallet signing and QR checkout from a second device/browser.
3. Finish production operational hardening, including rate limits, monitoring, backups, and operator-key custody.
4. Export the Wave 2 slide source to the format required by the submission and capture the merchant-created QR, buyer payment, agent resource access, settlement proofs, trove-aware policy decisions, and audit evidence in a short demo.
