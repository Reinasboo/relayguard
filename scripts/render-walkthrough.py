"""Create a captioned, silent reviewer demo from real product captures.

This deliberately does not imply a new wallet transfer. Narration is in wave2/DEMO.md.
"""
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont
from submission_fonts import font_paths

root = Path(__file__).resolve().parents[1]
source = root / "output/review"
out = root / "output/video"
frames = root / "tmp/demo-frames"
out.mkdir(parents=True, exist_ok=True)
frames.mkdir(parents=True, exist_ok=True)
regular, semibold = font_paths(root)
font = lambda size, bold=False: ImageFont.truetype(str(semibold if bold else regular), size)
scenes = [
    ("01-review-desktop.png", ["Accept MUSD.", "Verify the", "payment."], ["Customer invoices.", "Paid API access.", "Direct merchant settlement."], "Real local product UI"),
    ("02-mezo-evidence.png", ["Two payments.", "One merchant."], ["1.00 MUSD invoice.", "0.001 MUSD API access.", "Historical receipts rechecked", "against Mezo RPC."], "Historical Testnet transfers / verification at capture time"),
    ("policy-healthy.png", ["180% ICR", "Within policy."], ["The same policy functions", "check exact amounts,", "destinations and limits."], "Controlled policy example / no authorization or transaction created"),
    ("policy-review.png", ["125% ICR", "Human review."], ["Below the app's 150%", "review buffer, every", "positive MUSD payment", "needs human approval."], "Controlled policy example / operator treasury rules"),
    ("policy-blocked.png", ["109% ICR", "Payment", "blocked."], ["Below Mezo's 110%", "minimum, the policy stops", "before signing or submission."], "Controlled policy example / no funds move"),
    ("policy-unavailable.png", ["RPC offline.", "MUSD paused."], ["If protocol reads fail,", "MUSD authorization pauses.", "No assumed approval."], "Controlled policy example / unavailable reads fail closed")
]
for index,(filename,heading,body,disclosure) in enumerate(scenes):
    canvas = Image.new("RGB", (1920,1080), "#181a19")
    d = ImageDraw.Draw(canvas)
    d.text((64,40), "RelayGuard", font=font(34,True), fill="#b7f566")
    d.text((64,100), "MEZO BUILDATHON / WAVE 2", font=font(19), fill="#b1b9b1")
    for i,line in enumerate(heading): d.text((64,240+i*68),line,font=font(54,True),fill="#f0f2ed")
    body_top = 280+len(heading)*68
    for i,line in enumerate(body): d.text((64,body_top+i*37),line,font=font(24),fill="#b1b9b1")
    shot = Image.open(source/filename).convert("RGB")
    if filename == "01-review-desktop.png": shot=shot.crop((0,0,1440,1000))
    shot.thumbnail((1320,916),Image.Resampling.LANCZOS)
    canvas.paste(shot,(560+(1320-shot.width)//2,88+(916-shot.height)//2))
    d.line((64,1016,1856,1016),fill="#3b413c",width=2)
    d.text((64,1032),disclosure,font=font(20),fill="#b7f566")
    d.text((1710,1032),f"{index+1:02} / 06",font=font(20),fill="#b1b9b1")
    canvas.save(frames/f"scene-{index+1:02}.png")

# Eight seconds per actual UI capture. No artificial payment or wallet footage.
subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-framerate","1/8",
    "-i",str(frames/"scene-%02d.png"),"-c:v","libx264","-preset","veryfast","-crf","20",
    "-r","30","-pix_fmt","yuv420p","-movflags","+faststart",str(out/"relayguard-reviewer-demo.mp4")],check=True)
print(out/"relayguard-reviewer-demo.mp4")
