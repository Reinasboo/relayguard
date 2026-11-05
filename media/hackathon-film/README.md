# RelayGuard submission production

This is the editable production project for the November 5 Wave 2 materials. It uses the maintainer's navy UI from `f74c1a4` and captures of `relayguard.vercel.app`.

## Deliverables

- `output/hackathon/video/relayguard-demo.mp4`: 120 seconds, 1920×1080, 30 fps, H.264/AAC, neural narration and embedded visual captions.
- `output/hackathon/screens/`: seven independent 2400×1600 submission images.
- `public/submission/relayguard-wave2.pdf`: ten-slide deck with selectable typography and working links.
- `output/hackathon/relayguard-wave2-submission.zip`: judge-facing assets only.

## Reproduce

From the repository root, install the application dependencies with `npm ci` and build with `npm run build`. Install Python media packages with `py -m pip install -r scripts/requirements-media.txt`. Chrome and ffmpeg must be on the machine. Set `CHROME_PATH` if Chrome is installed at a custom path. On other platforms, use `python` in place of the Windows `py` launcher.

```powershell
node scripts/capture-hackathon.mjs
node scripts/capture-challenge.mjs
py scripts/design-hackathon-materials.py
npm ci --prefix media/hackathon-film
node media/hackathon-film/render.mjs stills
node media/hackathon-film/render.mjs video
py scripts/package-hackathon.py
py scripts/verify-hackathon.py
```

Existing committed narration and timings are sufficient to reproduce the edit. To change the narration, edit `narration.txt`, install `kokoro-onnx==0.4.7` and `soundfile`, obtain the official [Kokoro ONNX model and voices](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1), and place them at `tmp/voice-model/kokoro-fast.onnx` and `tmp/voice-model/voices.bin`. Run `py scripts/narrate-demo-neural.py` before rendering. Model weights are excluded from git. The voice is Kokoro `af_heart`, conversational English, with sentence-level caption timings; no cloned voice is used. [Kokoro model license](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/LICENSE): Apache 2.0. Manrope font licensing is in `public/fonts/OFL.txt`.

The capture script uses a local read-only server and browser-only demo account fixtures for authenticated merchant and checkout states. Treasury, protocol policy, HTTP 402 and receipt views come from the public deployment. Capture timestamps and evidence are retained alongside the assets. No payment, approval, borrowing or production mutation is performed. Historical receipt status is preserved as captured, including unavailable RPC reads.

Older generators and videos remain for revision history. This directory and the current `ARTIFACTS.md` identify the active submission cut.
