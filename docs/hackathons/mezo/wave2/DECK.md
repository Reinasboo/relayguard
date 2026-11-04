# RelayGuard: MUSD payments, verified outcomes

Deck source for the current Wave 2 candidate. The reproducible PDF generator is `scripts/generate-submission.py`. Product imagery must come from `npm run verify:ui`, not the historical illustrative SVGs.

## 1. MUSD payments. Verified outcomes.

RelayGuard connects Mezo MUSD payments to merchant orders and paid API access. Access & Distribution. Mezo Buildathon Wave 2.

## 2. The missing step after a token transfer

The seller needs an order record, not just an increased wallet balance. An API developer needs settlement before releasing a response. RelayGuard connects an exact intent to a verified result.

## 3. One merchant. Two payment paths.

A customer opens a link or QR and signs a direct MUSD transfer. An agent receives HTTP 402 terms and signs an x402 authorization. Both settle directly to the merchant. The merchant keeps their storefront, API response and wallet.

## 4. Mezo supplies more than a token label

Canonical Testnet MUSD is the settlement asset. Mezo x402 provides the exact-payment path. TroveManager and PriceFeed supply pinned evidence for the operator's treasury policy. Buyer borrowing, if used, is separately reviewed and signed.

## 5. Protocol health changes the spending decision

At least 150% ICR: configured spending limits. 110% to below 150%: human approval for every positive MUSD payment. Below 110%: blocked. Unavailable reads: paused. The public lab calls the actual policy functions with explicitly controlled scenarios. Buyer checkout is separate from this operator policy.

## 6. Two historical payments. Independently checkable.

1.00 MUSD invoice and 0.001 MUSD x402 settlement to one merchant. Fresh verification matches the token event's payer, receiver and amount, including the facilitator's relayed transfer. Historical receipt links and raw JSON remain visible. Missing RPC evidence never becomes a verified badge.

## 7. Stronger boundaries and recovery

Explicit operator roles. Payer wallet ownership proof. Signed sessions for checkout mutations. Retry after wallet rejection. Repairable submission transitions. Exact decimal validation. HTTP tests exercise the actual app and stores with external services mocked.

## 8. A focused first market

API sellers and digital merchants already using MUSD. Hosted invoice first, Express middleware when needed. Three design partners are the next validation gate. Test a $19/month operations tier after activation. Pricing, adoption and revenue are hypotheses, not achieved traction.

## 9. The next milestone is repeat usage

Validate first-payment setup time, payment completion and repeat weekly use. Before public submission, deploy this revision, apply its access-control migration, verify a real-wallet checkout, and publish the narrated demo. Mainnet requires separate operational and security work.

## Evidence sources

- [Official Buildathon announcement and dates](https://mezo.org/blog/mezo-buildathon-is-underway)
- [Mezo x402 quickstart](https://testnet.mezo.org/docs/developers/getting-started/musd-payments-x402/x402-quickstart/)
- [Canonical contracts](https://testnet.mezo.org/docs/users/resources/contracts-reference)
- [MUSD integration guide](https://testnet.mezo.org/docs/developers/musd/)
- [Invoice receipt](https://explorer.test.mezo.org/tx/0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868)
- [x402 receipt](https://explorer.test.mezo.org/tx/0x1c37b9b069990a6b04ee7a2540dc5f62f2cca69636185ef75a0ee05379923f3c)
