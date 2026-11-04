# Submission form copy

Use this copy only after all open gates in the [release checklist](RELEASE_CHECKLIST.md) are cleared. The source revision is deployed, but the x402 challenge and production operator/checkout configuration still need verification. The event requires a live link, public repository, deck, and a two-minute pitch video. Upload the actual PDF/video and use their real public URLs. Do not paste local file paths as public deliverables.

**Project name:** RelayGuard

**Category (3–5 words):** Mezo MUSD Payment Operations

**TL;DR:** RelayGuard connects Mezo MUSD payments to merchant invoices and x402 API access, with direct wallet settlement, exact receipt verification, and protocol-aware treasury controls.

**How it works:** Merchants verify their receiving wallet and create MUSD payment links or QR invoices. Buyers sign direct transfers from their own wallets. RelayGuard matches successful receipt events to the exact payer, merchant, token and amount before marking an order paid. API developers can add the Express x402 adapter to their own server: clients receive exact MUSD terms and middleware releases the protected response after facilitator settlement. Separately, an assigned operator's MUSD treasury policy reads TroveManager and PriceFeed at one pinned block, requires human review below a 150% app buffer, blocks below the 110% protocol minimum, and pauses when reads fail. The public reviewer route makes the implementation and historical settlement evidence easy to inspect without funds or an account.

**Target group:** Small API vendors and digital merchants already using MUSD, initially in the Mezo developer ecosystem. Integration assumes familiarity with EVM wallets and, for APIs, Node/Express. Merchant configuration is designed for desktop; buyer checkout and public review support mobile. There is no validated regional expansion or paying-customer claim.

**Tech stack:** Node.js 22+, TypeScript, Express, viem, Mezo Testnet MUSD/TroveManager/PriceFeed/BorrowerOperations, x402 core/EVM/Express SDKs and Mezo facilitator, Supabase Auth/Postgres, SQLite for local development, vanilla browser JavaScript/CSS, Vercel, Node test runner, and Playwright browser checks.

**Track:** Track 2 — Access and Distribution for MUSD/MEZO.

**Chain:** Mezo Testnet, chain ID 31611.

**Status:** Existing RelayGuard hackathon project extended for Wave 2. The current build already includes merchant-owned destinations, merchant-scoped x402 integrations, buyer preflight, optional separately reviewed Testnet borrowing, pinned trove evidence, and stale-policy handling. This revision adds the public evidence walkthrough, controlled previews using the actual policy functions, explicit operator permissions, signed checkout sessions, retry/recovery fixes, and rebuilt submission materials. Do not attribute every current feature to this last revision.

**Readiness:** Testnet application with historical on-chain settlements. Public baseline: https://relayguard.vercel.app. This candidate must be deployed and its migration applied before claiming that the public URL includes the latest changes. No mainnet readiness claim.

**Public repository:** https://github.com/Reinasboo/relayguard

**Three proposed milestones:**

1. **By November 10, 2026:** apply the access-control migration, configure operator roles, deploy the candidate, and verify the reviewer and merchant routes.
2. **By November 12, 2026:** complete approved real-wallet checkout/x402 checks, publish the two-minute pitch, and verify every submission link. This targets the earlier deadline shown in the platform widget.
3. **By December 1, 2026:** run three design-partner pilots and report setup time, checkout completion, repeat use and willingness to pay. Pilot recruitment and these targets remain unvalidated plans.

**Team:** Praise, solo builder. Product design, full-stack implementation, Mezo integration and demo materials. Use the founder's existing AKINDO profile for verified X/LinkedIn details; no social URL has been invented here.

**Deck:** `public/submission/relayguard-wave2.pdf`, served at `/submission/relayguard-wave2.pdf`.

**Video:** `output/video/relayguard-wave2-pitch.mp4`, two-minute narrated local candidate cut. Stock system narration is labelled. Upload and verify playback, or replace the voice with the founder's recording from NARRATION.txt, before pasting the hosted URL.
