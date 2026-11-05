# Delivery verification / November 5, 2026

The current source is based on GitHub main `f74c1a4`. The final export uses the navy product interface, trimmed invoice and API recordings, conversational Kokoro narration, sentence captions and a five-second closing hold.

Observed checks:

- Seven separate PNGs, each exactly 2400 × 1600.
- Ten PDF pages with selectable text, thirteen link annotations and no clipped text blocks.
- MP4: exactly 120 seconds, 3600 frames, 1920 × 1080, 30 fps, H.264 video and AAC audio.
- Complete encoded video decoded successfully. Twenty-seven encoded chapter, cut and detail frames were extracted and visually inspected.
- Narration has 28 timed sentence captions. Exported audio measured −15.9 dB mean and −1.3 dB peak, with no clipping.
- Submission ZIP CRC and eleven-file inventory passed. A separate ZIP contains only the seven PNGs.
- The corrected UTF-8 HTTP 402 inspector passed a browser regression against the deployed endpoint. Script syntax and git whitespace checks passed.

The current application build succeeded during production. Application tests had already been completed for the underlying product revision; this work adds media verification and a focused browser check for the display fix.

The MP4 and PDF are mirrored at the existing pitch/deck download paths. `output/hackathon/delivery-manifest.json` records hashes for the judge-facing assets. `output/hackathon/verification.json` records the media checks. Source captures, read-only deployment evidence, narration and edit source are included with the PR. Temporary encodes, duplicate recording files, dependencies and model weights are excluded.
