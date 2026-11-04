"""Render the required two-minute pitch with local stock narration and real captures.

Run generate-submission.py, render-walkthrough.py and narrate-pitch.ps1 first.
The narration is replaceable with the founder's recording using the same script.
"""
from pathlib import Path
import wave
import json
import subprocess
import re
import pymupdf
from PIL import Image, ImageDraw, ImageFont
from submission_fonts import font_paths

root = Path(__file__).resolve().parents[1]
out = root / "output/video"
tmp = root / "tmp/pitch"
tmp.mkdir(parents=True, exist_ok=True)
parts = sorted((out/"narration").glob("part-*.wav"))
if len(parts)!=6: raise SystemExit("Run scripts/narrate-pitch.ps1 first.")
durations=[]
with wave.open(str(tmp/"narration.wav"),"wb") as merged:
    for index,path in enumerate(parts):
        with wave.open(str(path),"rb") as source:
            if index==0: merged.setparams(source.getparams())
            durations.append(source.getnframes()/source.getframerate())
            merged.writeframes(source.readframes(source.getnframes()))
factor=sum(durations)/114
scaled=[duration/factor for duration in durations]
pdf=pymupdf.open(root/"output/pdf/relayguard-wave2.pdf")
for number in [3,6,7,8,9]: pdf[number-1].get_pixmap(matrix=pymupdf.Matrix(2,2)).save(tmp/f"slide-{number}.png")
timeline=[(root/"tmp/demo-frames/scene-01.png",scaled[0]),(tmp/"slide-3.png",scaled[1]),(tmp/"slide-6.png",scaled[2])]
timeline.extend((root/f"tmp/demo-frames/scene-{i:02}.png",scaled[3]/4) for i in range(3,7))
timeline.extend([(tmp/"slide-7.png",scaled[4]),(tmp/"slide-8.png",scaled[5]),(tmp/"slide-9.png",6)])
font=ImageFont.truetype(str(font_paths(root)[0]),19)
manifest=["ffconcat version 1.0"]
for index,(source,duration) in enumerate(timeline):
    image=Image.open(source).convert("RGB").resize((1920,1080),Image.Resampling.LANCZOS)
    draw=ImageDraw.Draw(image)
    draw.rectangle((0,1016,1920,1080),fill="#181a19")
    draw.text((65,1040),"CURRENT LOCAL BUILD / MEZO TESTNET / STOCK VOICE NARRATION",font=font,fill="#b1b9b1")
    image.save(tmp/f"frame-{index:02}.png")
    manifest.extend([f"file 'frame-{index:02}.png'",f"duration {duration:.6f}"])
manifest.append(f"file 'frame-{len(timeline)-1:02}.png'")
(tmp/"frames.ffconcat").write_text("\n".join(manifest),encoding="utf-8")

# Sentence-level subtitles use proportional timing within the six narration parts.
paragraphs=re.split(r"\n\s*\n",(root/"docs/hackathons/mezo/wave2/NARRATION.txt").read_text(encoding="utf-8").strip())
def stamp(seconds):
    millis=round(seconds*1000)
    return f"{millis//3600000:02}:{millis//60000%60:02}:{millis//1000%60:02},{millis%1000:03}"
subtitles=[]
start=0
for paragraph,duration in zip(paragraphs,scaled):
    sentences=re.split(r"(?<=[.!?])\s+",paragraph)
    total=sum(len(sentence.split()) for sentence in sentences)
    cursor=start
    for sentence in sentences:
        length=duration*len(sentence.split())/total
        subtitles.extend([str(len(subtitles)//4+1),f"{stamp(cursor)} --> {stamp(cursor+length)}",sentence,""])
        cursor+=length
    start+=duration
srt=out/"relayguard-wave2-pitch.srt"
srt.write_text("\n".join(subtitles),encoding="utf-8")

video=out/"relayguard-wave2-pitch.mp4"
subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",str(tmp/"frames.ffconcat"),
    "-i",str(tmp/"narration.wav"),"-i",str(srt),"-map","0:v:0","-map","1:a:0","-map","2:0",
    "-af",f"atempo={factor:.8f},apad","-t","120","-c:v","libx264","-preset","veryfast","-crf","19","-r","30",
    "-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-c:s","mov_text","-metadata:s:s:0","language=eng",
    "-movflags","+faststart",str(video)],check=True)
print(json.dumps({"video":str(video),"duration":120,"stockVoice":"Microsoft David Desktop","tempo":factor,
    "subtitles":str(srt),"paragraphDurations":scaled}))
