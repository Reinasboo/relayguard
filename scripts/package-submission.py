"""Package reviewable submission materials only. Never includes env files or keys."""
from pathlib import Path
import zipfile
import shutil

root=Path(__file__).resolve().parents[1]
out=root/"output/submission"
out.mkdir(parents=True,exist_ok=True)
evidence=root/"output/review/live-evidence.json"
if evidence.exists():
    shutil.copyfile(evidence,root/"docs/hackathons/mezo/wave2/evidence-2026-11-04.json")
files=[
    (root/"public/submission/relayguard-wave2.pdf","relayguard-wave2.pdf"),
    (root/"output/video/relayguard-wave2-pitch.mp4","relayguard-wave2-pitch.mp4"),
    (root/"output/video/relayguard-wave2-pitch.srt","relayguard-wave2-pitch.srt"),
    (root/"output/video/relayguard-reviewer-demo.mp4","reviewer-walkthrough-48s.mp4")
]
files.extend((path,f"source/{path.name}") for path in (root/"docs/hackathons/mezo/wave2").iterdir() if path.suffix in [".md",".txt",".json"])
files.extend((root/f"output/review/{name}",f"screens/{name}") for name in ["02-mezo-evidence.png","03-policy-lab.png","responsive-390.png"])
archive=out/"relayguard-wave2-submission.zip"
with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as package:
    for source,destination in files:
        if not source.exists(): raise SystemExit(f"Missing artifact: {source}")
        package.write(source,destination)
print(archive)
