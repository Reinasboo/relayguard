# Visual system — November 4, 2026

This revision follows the owner's supplied anti-slop rules, recorded in [design.md](../../../../design.md). It addresses the inconsistent layout and component styling reported after PR #2 was merged.

## Direction and implementation

A quiet navy payment workspace, clear settlement records, and lime reserved for the next action. Manrope is the single UI typeface. Inputs and prose use 16px text; supporting labels use 14px. The palette uses `#0c1117` for the canvas, `#111820` for surfaces, `#151e28` for raised elements, `#24303d` for borders, `#e8edf3` for text, and `#b7f566` for the accent. The established subtle navy canvas background is retained.

- `public/experience.css` owns the palette, type, controls, focus states and wallet dialog.
- `public/styles.css` owns the merchant, treasury, help and checkout layouts.
- `public/review.css` owns the reviewer page. It no longer imports the workspace stylesheet.
- Both pages load shared primitives first, followed by their own components. Page components do not override the other page.

The merchant workspace starts with account access and invoice creation. Optional API setup and the example agent purchase are disclosed below that flow. The mobile navigation is compact and labelled. The orbit illustrations, duplicated promotional block, arbitrary card numbers and repeated uppercase section labels have been removed or suppressed. Actual setup steps and payment states remain visible.

The reviewer uses a payment-route panel, an editorial integration list, two receipt records and the controlled policy tool. Links and state colors retain their meaning. No traction or live-wallet evidence was invented.

## Verification

- `npm test`: 63 passing, 0 failing.
- `node scripts/audit-visual.mjs`: 50 combinations across 320, 390, 768, 1024 and 1440px. Covers merchant, treasury, help, review, checkout error/open/paid, account forms, connected account and populated invoices/API resources.
- Browser checks exercise history navigation, invalid policy states, keyboard skip links, local font delivery and separation of sign-out from wallet settings.
- Populated captures use labelled browser fixtures with long descriptions and expanded developer tools. They do not represent customer activity or new settlement.
- Actual screenshots were inspected for hierarchy, label/input alignment, wrapping and state visibility. `npm run verify:ui` also checks the policy scenarios and interrupted broadcast recovery.
- Read-only checks of the existing public deployment returned the expected MUSD 402 challenge and protected audit response. Deployment of this revision and funded wallet acceptance remain release checks.

Review [the captures and machine-readable results](../../../../output/visual-audit/). These submitted captures and the generated PDF/videos preserve the earlier charcoal visual iteration; they are retained as hackathon materials and are not color references for the current navy styles. No payment, borrowing or approval was broadcast.

The existing media typography uses Manrope; its charcoal colors are preserved as part of the earlier submission snapshot. Install Python rendering dependencies with `python -m pip install -r scripts/requirements-media.txt`. The generators derive regular and semibold static font instances from the licensed font already in the repository; temporary instances are not committed.
