# Complete review package

This PR includes the implementation, tests, deployment configuration, database migration, editable submission copy, generation scripts and generated review materials.

- [PDF deck](../../../../public/submission/relayguard-wave2.pdf)
- [Two-minute narrated pitch](media/relayguard-wave2-pitch.mp4), [subtitles](media/relayguard-wave2-pitch.srt), [48-second walkthrough](media/relayguard-reviewer-demo.mp4)
- [Packaged submission ZIP](../../../../output/submission/relayguard-wave2-submission.zip)
- [Screenshots, policy states, live evidence, browser results and raw recordings](../../../../output/review/)
- [Public AKINDO research and timeline capture](../../../../output/research/)
- [Audio segments and generated videos](../../../../output/video/)
- [Validation and limits](VALIDATION.md), [maintainer release checks](RELEASE_CHECKLIST.md)

Download videos or the ZIP to inspect them locally. All captured outputs are included in this branch; new output remains ignored by default. Credentials, dependencies, compiled application files and temporary rendering intermediates are excluded.

The pitch uses stock Windows narration and captures the local candidate, historical Testnet receipts and labelled controlled scenarios. It does not demonstrate a fresh deployed wallet payment. Follow the release checks before submitting or merging for production.

To review the application: use Node 22.5 or newer, run `npm ci`, `npm test`, then `npm run review`. Open `/review` on the printed local URL. Reviewer mode needs no private key or merchant account. `npm run verify:ui` additionally requires Chrome available to Playwright. Media generators need Windows fonts, Python with ReportLab/Pillow/PyMuPDF, and ffmpeg; the narration script uses Windows speech synthesis.
