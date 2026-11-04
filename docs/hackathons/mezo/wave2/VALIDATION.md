# Candidate validation — November 4, 2026

## Automated checks

- TypeScript/browser build completed.
- Node test suite: **63 passing, 0 failing**, including actual HTTP route boundaries, interrupted-state recovery with real stores, and checkout retry/recovery with mocked authentication and RPC services.
- Chrome/Playwright checks passed at 390, 768 and 1440 pixel widths without horizontal overflow or page errors.
- Four controlled policy scenarios and the per-transaction limit were exercised through the real reviewer HTTP endpoint.
- The merchant workspace is the default application view.
- Reviewer mode denied payment mutations without a private key or Supabase account.
- An unrecorded browser regression reloaded a previously broadcast attempt, reconciled its saved hash, reached the mocked paid state, and requested no second wallet transfer.
- Browser scripts pass syntax checks and `git diff --check` is clean.

## Live read-only Mezo evidence

Fresh RPC checks during the reviewer capture verified chain 31611, deployed canonical MUSD with symbol MUSD and 18 decimals, and both historical payment Transfer events:

| Path | Amount | Receipt block | Expected merchant |
|---|---|---|---|
| Invoice | 1.00 MUSD | 16372688 | `0x840E5bBF20D725f581752f8A4021ADd730550d47` |
| x402 | 0.001 MUSD | 16372674 | Same receiver |

The evidence reader checks the token event's payer, exact amount and recipient. The facilitator's outer x402 transaction sender is not mistaken for the token payer. RPC receipt availability was transient on an initial read, which is why the UI exposes unverified/error states and retry instead of inferring success.

No wallet transaction, new borrowing, token approval or payment was broadcast during this revision. The captured historical evidence and controlled policy scenarios are explicitly labelled.

Read-only public-deployment checks also returned HTTP 200 for the existing app, wallet module and health route; HTTP 401 for the unauthenticated audit; and HTTP 402 for the paid resource with chain `eip155:31611`, canonical MUSD, exact `1000000000000000` base units and the expected merchant. This checks the existing deployment, not deployment of the local changes.

## Materials

- Nine-page PDF, rebuilt from editable source and actual product captures. Every page rendered and visually checked. A title/screenshot overlap found during review was corrected.
- Captioned silent reviewer walkthrough, 48 seconds.
- Two-minute local pitch cut with stock narration and an English subtitle track. Voice/script are replaceable. Check its final playback before public upload.
- Current pitch, form copy, technical brief, demo/narration and release checklist are in this directory. Earlier illustrative decks remain historical.
- AKINDO's rendered event confirmed the deck and two-minute pitch requirement and the 30/30/20/10/10 rubric. The platform widget and written schedule conflict on the deadline; this is documented rather than silently choosing November 15.

## Not validated by these checks

Production deployment of this revision, application of the hosted migration, real-wallet signing on a second device, a fresh paid browser x402 flow, Postgres concurrency/failure injection, customer traction and mainnet readiness. These remain explicit release or pilot gates.
