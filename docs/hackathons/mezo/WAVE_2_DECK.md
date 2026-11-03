---
marp: true
theme: uncover
paginate: true
size: 16:9
style: |
  section {
    background: #0c1117;
    color: #e8edf3;
    font-family: Aptos, Inter, sans-serif;
    font-size: 24px;
    padding: 54px 64px;
  }
  h1, h2, strong { color: #b7f566; }
  h1 { font-size: 48px; }
  h2 { font-size: 34px; }
  a { color: #b7f566; }
  footer { color: #83909f; }
---

# RelayGuard
## MUSD payments with protocol-aware controls

**Wave 2 · Mezo Testnet**

Praise · Solo builder

QR checkout for people. x402 access for agents. A Mezo-native spending policy for both.

---

## MUSD needs a safer path into everyday commerce

- Merchants need a simple way to quote, collect, and verify MUSD.
- Agents need exact, machine-readable payment terms before a protected API releases value.
- A generic ERC-20 transfer does not account for the Bitcoin-backed borrowing position that may sit behind an operator's MUSD treasury.

**RelayGuard connects the payment to the policy and the relevant Mezo protocol state.**

---

## One merchant destination. Two ways to pay.

<img src="./screens/03-merchant-checkout.svg" alt="RelayGuard MUSD merchant checkout" width="82%">

*Illustrative product screen; not a captured live transaction.*

- **People:** a fixed MUSD invoice, shareable checkout link, and QR; the buyer signs the exact transfer in their wallet.
- **Agents:** an x402-protected resource with exact MUSD terms; the facilitator verifies and settles before the resource is unlocked.
- Both flows route to the merchant's configured receiving wallet. Checkout funds are not held by RelayGuard.

---

## The Wave 2 difference: policy reads Mezo trove health

RelayGuard reads the configured operator's trove status, live Mezo `PriceFeed`, and protocol-computed `TroveManager.getCurrentICR`.

| Observed ICR | MUSD agent-payment decision |
|---|---|
| At least 150% | Apply configured transaction and daily limits |
| 110% to below 150% | Require explicit human approval for every positive payment |
| Below 110% | Block new authorization, approval, and execution |
| Protocol read unavailable | Fail closed for MUSD; BTC policy remains separate |

These are operator treasury controls, not a requirement for buyers to open a trove. RelayGuard does not borrow, add collateral, or modify troves automatically.

**Status:** implemented and covered by local tests; deployment of these Wave 2 controls and live threshold verification remain outstanding.

---

## Reliability is part of payment safety

<img src="./screens/05-verified-settlement.svg" alt="RelayGuard verified settlement screen" width="82%">

*Illustrative product screen; see the linked test evidence for actual settlement records.*

- Invoice loads time out with a clear retry action instead of spinning indefinitely.
- Submitted-payment verification is bounded to 20 automatic checks, then offers a manual retry.
- The UI explicitly warns customers not to pay again while a transaction is still being verified.
- If a policy-relevant trove risk tier changes after authorization, execution stops; the operator can cancel the stale authorization and request a fresh policy decision.

**Status:** implemented in the current working tree; deploy and production smoke-test before presenting it as live.

---

## Evidence from Mezo Testnet

- **1.00 MUSD invoice:** settled to the configured merchant and verified against the exact token transfer.
- **0.001 MUSD x402 resource:** facilitator settlement was verified; the protected resource was returned.
- Both historical payments reached the same merchant receiver.
- **35 automated tests pass locally**, including protocol-risk boundaries, receipt verification, authorization lifecycle, and x402 typed-data signing.

Full transaction references and test limitations: [test results](./TEST_RESULTS.md). These are testnet results, not mainnet production evidence.

---

## Business model — proposed, not yet enabled

**Free pilot** for initial merchants, followed by:

- **$19/month** for a merchant workspace with invoices, policy controls, audit history, and agent/API configuration.
- **0.5% fee** on successfully settled MUSD invoices, disclosed before merchant activation.

These are planning assumptions, not current product charges. RelayGuard does not currently collect a platform fee; checkout settlement goes directly to the configured merchant. Validate willingness to pay and unit economics with pilot merchants before enabling billing.

---

## Milestones — proposed dates

| Date | Milestone | Proof of completion |
|---|---|---|
| **Nov 10, 2026** | Deploy trove-aware policy and bounded checkout recovery | Live health read; test decisions above 150%, between 110–150%, below 110%, and RPC failure |
| **Nov 17, 2026** | Verify customer checkout end to end on a second device | Merchant login, invoice creation, QR scan, wallet signature, and confirmed receipt |
| **Dec 1, 2026** | Run a small merchant/agent pilot | Interview 3 merchants; measure invoice completion, API unlocks, settlement time, and support issues |

Dates and pilot targets are proposals and should be confirmed before external use.

---

## Team

**Praise — solo builder**

Product ownership and implementation of RelayGuard's merchant checkout, agent-payment flow, Mezo integration, and submission materials.

**Ask:** feedback and mentorship on merchant adoption, safe treasury policy design, and the path from testnet demo to production-grade payment operations.

---

## RelayGuard

### Make MUSD usable. Make agent spending accountable.

[Live app](https://relayguard.vercel.app) · [Product strategy](./PRODUCT_STRATEGY.md) · [Test evidence](./TEST_RESULTS.md)

**Mezo Testnet · Chain ID 31611**
