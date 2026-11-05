# RelayGuard — Mezo Buildathon, Wave 2

**Turn MUSD into paid orders and paid API access.**

RelayGuard is a payment operations layer for merchants and API developers on Mezo. A merchant verifies a receiving wallet, creates an exact MUSD invoice, and shares a checkout link or QR. A customer pays directly from their wallet. RelayGuard connects the order to the receipt and marks it paid only after the token, payer, recipient, and amount match.

The same merchant can sell an API response through x402. An agent receives exact MUSD payment terms, signs an authorization, and receives the resource after facilitator settlement. The merchant keeps its own API and receives MUSD directly.

For an operator spending MUSD liquidity, RelayGuard also reads Mezo's TroveManager and PriceFeed at one block. It adds human review below its 150% ICR buffer, blocks below the protocol's 110% minimum, and pauses MUSD authorization when reads fail.

**The result: usable MUSD commerce with a verifiable answer to “was this paid?”**

## Track and judge entry point

**Access & Distribution.** Mezo supplies the payment asset, network, protocol state, and x402 integration. RelayGuard packages them into merchant workflows that do not require merchants to build payment infrastructure.

- Existing public deployment: https://relayguard.vercel.app
- Public reviewer walkthrough: https://relayguard.vercel.app/review
- Local review without accounts, keys, or funds: `npm ci`, then `npm run review`, then open `/review`.
- Historical evidence: [transaction ledger](../TEST_RESULTS.md).
- Current implementation: [technical brief](TECHNICAL.md).
- Demo narration and recording: [demo script](DEMO.md).
- Current deck: [PDF](../../../../public/submission/relayguard-wave2.pdf). Current [demo, seven submission images and ZIP](ARTIFACTS.md).

## Wave 2 progression

The project had already improved after the original judging. The pre-revision build includes merchant wallet ownership verification, merchant-scoped x402 resources and keys, buyer balance/gas preflight, optional separately reviewed Testnet borrowing, pinned trove evidence, and stale-policy handling. These are part of the current Wave 2 product, not all attributed to the latest fixes.

This revision adds a public evidence walkthrough, live contract/receipt rechecks, controlled previews using the actual policy functions, explicit operator roles, signed buyer ownership proofs, protected checkout sessions, same-payer retry after cancellation, and repairable submission transitions. It also fixes local wallet-module delivery and rejects amounts that would require rounding.

## First customer and business hypothesis

Start with small API vendors and digital merchants who already hold or accept MUSD. They need order reconciliation and exact paid access. They do not need a new storefront or a mandatory loan just to accept payments.

Recruit three design partners and measure time to first verified payment, completed/attempted checkouts, support issues, and repeat weekly use. A proposed $19/month operations tier can be tested after successful activation. Revenue, adoption, and willingness to pay are unvalidated. No platform fee is collected today.

At that assumed price, 20 paying merchants produce $380 monthly subscription revenue and 100 produce $1,900, before operating costs. These are arithmetic scenarios, not forecasts. Measure hosting, RPC, monitoring and support costs before claiming a margin. The previously proposed 0.5% fee is not implemented and is not part of this submission's revenue claim.

## Why users would choose it

| Approach | Work left to the merchant | RelayGuard contribution |
|---|---|---|
| Share a wallet address | Match payer, amount and order manually | Exact invoice, QR/link, lifecycle and receipt matching |
| Integrate raw x402 | Maintain merchant terms and receiving-wallet configuration | Verified destination, per-resource credentials, dynamic terms |
| Use a general wallet dashboard | Build a checkout and order record | Buyer flow and payment operations in one workspace |

These are workflow comparisons, not claims of exclusive features or measured competitor superiority. The x402 and blockchain SDKs remain essential dependencies.

## What the evidence proves

The repository records a 1.00 MUSD invoice and a 0.001 MUSD x402 settlement to the same merchant, with explorer links. The new review route attempts fresh RPC verification and reports missing or mismatched evidence explicitly. Controlled risk scenarios demonstrate the real policy code without creating transactions. Testnet history is not mainnet traction.

The operator risk overlay does not claim that spending MUSD changes a trove collateral ratio. Buyer invoice payments have separate wallet and balance checks. Optional borrowing is a separately reviewed Testnet transaction with debt and liquidation risk.

## Delivery boundary

The changes in this revision require deployment, the new database migration, and an operator-user allowlist before the public app reflects them. A fresh real-wallet, second-device checkout and full recorded paid x402 browser flow remain release checks. Production operation also needs signer custody, shared rate limits, monitoring, backups, Postgres failure/concurrency tests, and independent security review.

## Official event details, checked November 4, 2026

The [official Mezo announcement](https://mezo.org/blog/mezo-buildathon-is-underway) names Access & Distribution and DeFi, requires a working deployment with MUSD and/or MEZO integration, welcomes Testnet submissions, and sets Wave 2 to November 2–15 with final submissions on November 15, 2026.

The rendered [AKINDO event](https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10) requires a live project link, public GitHub repository, project/product deck, and **a 2-minute pitch video**. It explicitly asks Wave 2 resubmissions to describe progress since Wave 1. The evaluation weights are integration 30%, business viability 30%, implementation 20%, UX 10%, and materials 10%.

**Deadline discrepancy:** the written schedule and Mezo blog say November 15. The current AKINDO timeline widget shows a November 13 submission cutoff and a different judging schedule. Treat the earlier date as the operational target and confirm the cutoff with the organizer before relying on November 15. Do not infer a timezone from an unlabelled widget.
