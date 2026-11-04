# Visual experience audit — November 4, 2026

Audited the merged Wave 2 revision (`aa72f94`) in Chrome, then corrected the issues on `codex/visual-experience-audit`.

## Findings and fixes

| Finding | Correction |
| --- | --- |
| Layout overflowed 320px phones | Removed the 360px body minimum; allowed header, profile and endpoint content to wrap |
| Mobile navigation showed unexplained icons | Kept visible workspace labels with larger targets, including tablet layouts |
| Sidebar and fixed hero art squeezed tablet forms | Moved tablet navigation above content; hid decorative art; stacked wallet settings |
| Signed-in sign-out action could collide with receiving wallet settings | Returned account actions to normal document flow |
| Workspace captions were 7–11px and inputs were small | Raised captions to 12px minimum; used 14px supporting copy and 16px inputs/buttons; bundled licensed Manrope locally |
| Keyboard focus was inconsistent | Added shared focus rings, skip links and reduced motion support |
| Customer checkout inherited the workspace sidebar margin | Centered checkout independently and removed its unrelated workspace header |
| Loading/error labels remained misleading | Replaced failed merchant loading labels, marked unavailable invoices explicitly, and removed a permanent connecting label |
| Back/Forward did not restore workspace views | Used history entries for view changes and synchronized history/hash navigation |
| Invalid policy input retained the last successful result style and steps | Rendered an error decision, cleared stale steps and exposed pending state |
| Disabled paid API copy exposed environment variable names | Replaced it with a customer-facing availability explanation |

## Verification

- `npm test`: 63 passing, 0 failing.
- `node scripts/audit-visual.mjs`: 36 page/state/width combinations across 320, 390, 768 and 1440 pixels, no horizontal overflow or browser exceptions. Includes merchant, treasury, FAQ, review, checkout error, account form, connected merchant, open checkout and paid checkout.
- Regression checks exercise workspace Back/Forward, invalid policy styling, keyboard skip-to-content and local font delivery.
- `npm run verify:ui` additionally exercises policy scenarios and interrupted broadcast recovery.
- Captures and machine-readable results are in [output/visual-audit](../../../../output/visual-audit/). Account and open/paid checkout captures use explicitly named browser fixtures; they do not prove wallet signing or settlement.

The review uses the local candidate. Hosted migration/deployment, fresh funded wallet acceptance and production accessibility testing remain release checks. No payment or approval was broadcast. The submission PDF and video captures are refreshed from the updated reviewer UI; the narration and historical-evidence disclosures remain applicable.

The latest read-only evidence capture verified the invoice receipt while the x402 historical receipt read was unavailable. The refreshed deck preserves that unavailable state and its explorer link; earlier successful verification is recorded in VALIDATION.md. An unavailable read is not presented as a fresh successful verification.
