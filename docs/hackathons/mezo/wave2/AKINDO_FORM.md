# RelayGuard / Mezo Wave 2

Use this copy only after all open gates in the [release checklist](RELEASE_CHECKLIST.md) are cleared. The source revision is deployed, but production configuration and the x402 challenge still need verification. Upload the actual PDF/video and use their public URLs; do not paste local file paths.

**Project name:** RelayGuard

**Category:** MUSD Merchant Payment Operations

**TL;DR:** Sell in MUSD. Know what was paid. RelayGuard connects Mezo MUSD payments to merchant orders and paid API access, with direct wallet settlement and inspectable payment verification.

**Problem:** Receiving a token transfer does not tell a seller which order to fulfil. Merchants need a payment request, a defined price and expiry, and a reliable way to match a receipt to a customer. API developers need to confirm settlement before releasing a paid response.

**Solution:** Merchants verify a receiving wallet and create MUSD invoices with a checkout link or QR code. Customers review the amount, recipient and Mezo network before authorizing a direct payment. RelayGuard verifies the successful receipt and matching MUSD Transfer event against the payer, merchant and exact atomic amount before marking the invoice paid.

**Developer experience:** Register a paid route and price, then add the Express x402 adapter to an API. An unpaid request receives HTTP 402 payment requirements. The facilitator settles the signed MUSD authorization before the protected response is released. The merchant retains the API and receives funds directly.

**Mezo integration:** Canonical MUSD on Mezo Testnet is the settlement asset. TroveManager and PriceFeed provide pinned-block collateral and debt context for the operator's treasury policy. Below the 150% application buffer, positive MUSD payments require human approval; below the 110% protocol minimum, spending is blocked. Unavailable reads pause authorization. Buyer checkout remains a separate wallet flow. The public reviewer exposes historical receipt evidence and controlled scenarios using the real policy functions.

**Target users:** API sellers and digital merchants already using MUSD, starting with the Mezo developer ecosystem.

**Business model:** Validate a $19/month merchant operations tier through a three-design-partner pilot. Measure time to first payment, checkout completion, repeat activity and willingness to pay.

**Wave 2 progress:** Merchant wallet ownership verification, merchant-scoped API resources, buyer preflight, optional separately reviewed Testnet borrowing, pinned trove evidence and stale-policy handling now sit alongside a public reviewer, explicit operator permissions, signed checkout sessions, payment retry/recovery, exact amount validation and a refined responsive interface. The updated submission includes a two-minute narrated demo, seven product images and a redesigned ten-page deck.

**Implementation:** Node.js 22+, TypeScript, Express, viem, Mezo MUSD/TroveManager/PriceFeed/BorrowerOperations, x402 SDKs and Mezo facilitator, Supabase Auth/Postgres, SQLite for local development, Vercel, Node tests and Playwright. The automated suite contains 63 tests.

**Track:** Access & Distribution

**Network:** Mezo Testnet / chain 31611

**Product:** https://relayguard.vercel.app

**Public reviewer:** https://relayguard.vercel.app/review

**Repository:** https://github.com/Reinasboo/relayguard

**Deck:** https://relayguard.vercel.app/submission/relayguard-wave2.pdf

**Demo:** `output/hackathon/video/relayguard-demo.mp4`

**Submission images:** `output/hackathon/screens/01-merchant-workspace.png` through `07-settlement-evidence.png`

**Team:** Praise, solo builder. Product design, full-stack engineering and Mezo integration.

**Next milestones:** Recruit three design partners; complete observed merchant activation and payment sessions; publish pilot findings on first payment, completion, repeat use and pricing.
