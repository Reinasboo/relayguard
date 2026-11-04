# Wave 2 release and submission checklist

The original judge scores were Mezo integration 4/10, business viability 6/10, technical implementation 6/10, UX 6/10 and submission materials 2/10. They describe the reviewed submission. They are not a score for every subsequent repository improvement. No new score is promised.

## Candidate acceptance

- [x] Provide a public reviewer route with readable integration explanation and direct evidence links.
- [x] Separate live contract/receipt checks from controlled policy scenarios.
- [x] Give reviewers a local command that needs no private key, account or funds.
- [x] Restrict shared treasury APIs to explicitly assigned operators.
- [x] Verify payer wallet ownership before reserving invoices and protect submit/release with a bound session.
- [x] Make rejected attempts retryable and submitted transitions repairable.
- [x] Fix local wallet-module delivery and reject excess decimal precision.
- [x] Add the forward migration protecting wallet-attestation fields from direct browser writes.
- [x] Add HTTP regression tests, public-policy tests and signature/capability tests.
- [x] Rewrite the product pitch, business hypothesis, technical explanation and timed demo around the current build.

## Before sending the final submission

- [x] Run test and browser checks for this candidate. Record evidence in VALIDATION.md. Repeat if the candidate changes before deployment.
- [ ] Apply `20261104000000_restrict_wallet_verification.sql` to the hosted database.
- [ ] Set `RELAYGUARD_OPERATOR_USER_IDS` and an independent checkout secret in production.
- [x] Deploy this revision. `/review` and the submission PDF returned HTTP 200 in the November 4 spot check.
- [ ] Check the real x402 endpoint returns a valid canonical MUSD challenge.
- [ ] Complete a fresh funded-wallet checkout and x402 browser payment with approved Testnet funds.
- [ ] Record the narrated demo. Upload it and verify the actual public playback URL.
- [x] Check the rendered AKINDO event for fields, required deck/two-minute video, rubric weights and timeline. Written and widget deadlines conflict; use the earlier November 13 target pending organizer confirmation.
- [ ] Paste current text from SUBMISSION.md. Attach the current PDF and real demo link. Confirm links in incognito.

## After the buildathon

- [ ] Run three design-partner pilots. Measure activation, completion and repeat use.
- [ ] Validate willingness to pay before implementing billing.
- [ ] Add shared rate limits, monitoring, backups and independent signer/security review before mainnet.

## Latest production spot check — November 4, 2026

- Vercel reports the current source deployment as `READY`; `/review` and `/submission/relayguard-wave2.pdf` returned HTTP 200.
- The production environment-variable inventory does not include `RELAYGUARD_OPERATOR_USER_IDS` or `RELAYGUARD_CHECKOUT_SECRET`. Configure both before relying on operator or checkout mutation flows.
- `GET /api/paid-resource` returned HTTP 502 after the facilitator's `/supported` request timed out. This single check does not establish whether the facilitator failure is transient; retry and verify a valid 402 challenge before release.
- The hosted wallet-verification migration is still an open release item; confirm remote migration history after applying it.
