# A paid order, with proof

Required pitch length: **2 minutes**, confirmed on the rendered AKINDO event page. Use [NARRATION.txt](NARRATION.txt) as the concise voice script. The scene notes below are the editing guide. Record the deployed revision, hide credentials, and use a separate funded Testnet buyer only for approved transactions.

## 0:00–0:15 — The product

**Screen:** `/review`, hero and the two payment paths.

**Say:** “RelayGuard turns Mezo MUSD into paid orders and paid API access. Merchants receive funds directly. RelayGuard answers the operational question: which order was paid, by whom, and for how much?”

## 0:15–0:45 — One customer order

**Screen:** Merchant workspace, verified receiving wallet, a new small invoice, its link and QR, then the buyer checkout. Show the exact recipient and amount.

**Say:** “The merchant owns the receiving wallet. The buyer verifies their wallet and signs a direct MUSD transfer. The first signature proves ownership. The second sends the payment. RelayGuard never asks for a private key.”

**Action:** With permission to use the funded Testnet account, pay and wait for receipt verification. Show `paid` and the explorer receipt. Cut waiting time and label the time cut.

**Fallback without a live funded wallet:** show the receipt panel and say “This is our recorded Testnet invoice payment, checked against RPC now.” Do not stage a simulated payment as live settlement.

## 0:45–1:05 — The agent flow

**Screen:** Actual HTTP 402 challenge, followed by the paid-API panel.

**Say:** “An API developer keeps their Express server and response. RelayGuard supplies a verified merchant destination and exact MUSD terms. The buyer signs x402 authorization. The facilitator settles before middleware releases the resource. Any required Permit2 approval is limited to the requested amount.”

**Action:** If wallet use is approved, show the resource response and settlement receipt. Otherwise identify the historical 0.001 MUSD transaction explicitly as historical evidence.

## 1:05–1:35 — Why Mezo

**Screen:** Current contract checks, then Healthy, Human review, Below minimum, and RPC unavailable in the policy lab.

**Say:** “MUSD is the payment asset. TroveManager and PriceFeed also inform the operator treasury policy. These four controlled scenarios call the same policy functions as the payment flow. Below our 150% review buffer, every positive MUSD request needs human approval. Below Mezo's 110% minimum, it is blocked. If reads fail, MUSD authorization pauses. No funds move in this preview.”

**Show:** 26 MUSD in the healthy example. The transaction cap still blocks it. Return to 1 MUSD.

**Clarify:** These are operator treasury rules. Buyer invoice payments do not automatically borrow or change a trove.

## 1:35–1:50 — The improvement

**Say:** “The current Wave 2 build adds merchant-owned destinations, configurable paid routes, wallet preflight and pinned protocol evidence. This revision makes that work easier to inspect and strengthens the boundaries. Merchant accounts cannot use the shared treasury signer, checkout mutations need a verified session, and rejected or interrupted attempts can recover.”

## 1:50–2:00 — The first market

**Screen:** First-customer section, then product hero.

**Say:** “We start with MUSD API sellers and digital merchants. Our next validation is three design partners: time to first payment, completion rate, and repeat use. RelayGuard gives MUSD holders a way to buy useful things, and sellers a verifiable way to get paid.”

## Recording handoff

Reviewable copies are committed in [media/](media/): [two-minute pitch](media/relayguard-wave2-pitch.mp4), [editable subtitles](media/relayguard-wave2-pitch.srt), and [48-second reviewer walkthrough](media/relayguard-reviewer-demo.mp4). Download the MP4 files for playback. These show the local candidate and labelled historical Testnet evidence; a fresh deployed wallet flow remains a release check.

- `output/video/relayguard-wave2-pitch.mp4` is the two-minute narrated local pitch cut. It uses labelled stock Windows narration because the connected ElevenLabs generation did not start. No generation was charged. Replace the voice with the founder's recording from NARRATION.txt if preferred.
- `output/video/relayguard-wave2-pitch.srt` contains editable subtitles. The MP4 includes an English subtitle track.
- `output/video/relayguard-reviewer-demo.mp4` is the supplementary 48-second silent, captioned reviewer walkthrough.

- `npm run verify:ui` captures the real local reviewer UI, live RPC evidence where available, responsive screenshots, and a silent browser walkthrough.
- That recording demonstrates the reviewer path. It does not claim a new wallet signature or transfer. Use it as B-roll or a clearly labelled reviewer demo.
- Keep Testnet and controlled-scenario labels readable. Show amounts, token, recipient and receipt result at a useful zoom.
- Use current captured product screens. Older SVG illustrations are not transaction proof.
- Check every public link in incognito after deployment.
- Upload the final narrated cut, verify playback, and put its actual URL into AKINDO. A local recording is not a hosted video link.
