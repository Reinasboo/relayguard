"""Package only current judge-facing assets; retain source and provenance separately."""
from pathlib import Path
import json, shutil, zipfile, hashlib
from PIL import Image, ImageDraw, ImageFont
from submission_fonts import font_paths
root=Path(__file__).resolve().parents[1]; out=root/'output/hackathon'
timings=json.loads((out/'audio/timings.json').read_text())
def stamp(t):
    ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'
srt='\n\n'.join(f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(timings['captions']))+'\n'
(out/'video/relayguard-demo.srt').write_text(srt,encoding='utf-8')
legacy=root/'docs/hackathons/mezo/wave2/media'
shutil.copy2(out/'video/relayguard-demo.mp4',legacy/'relayguard-wave2-pitch.mp4')
shutil.copy2(out/'video/relayguard-demo.srt',legacy/'relayguard-wave2-pitch.srt')
oldvideo=root/'output/video';oldvideo.mkdir(exist_ok=True)
shutil.copy2(out/'video/relayguard-demo.mp4',oldvideo/'relayguard-wave2-pitch.mp4')
shutil.copy2(out/'video/relayguard-demo.srt',oldvideo/'relayguard-wave2-pitch.srt')
shutil.copy2(root/'media/hackathon-film/narration.txt',root/'docs/hackathons/mezo/wave2/NARRATION.txt')
stills=sorted((out/'video/stills').glob('*.png'));regular,_=font_paths(root)
sheet=Image.new('RGB',(1920,((len(stills)+2)//3)*400),'#0c1117')
for i,p in enumerate(stills):
    im=Image.open(p);im.thumbnail((620,349));x=(i%3)*640;y=(i//3)*400;sheet.paste(im,(x+10,y+10))
    ImageDraw.Draw(sheet).text((x+10,y+365),f'Scene {i+1:02}',fill='#a8b4c1',font=ImageFont.truetype(str(regular),18))
sheet.save(out/'video/contact-sheet.jpg')
shutil.copy2(out/'video/stills/01.png',out/'video/cover.png')
files=[*sorted((out/'screens').glob('*.png')),out/'deck/relayguard-wave2.pdf',out/'video/relayguard-demo.mp4',out/'video/relayguard-demo.srt',out/'video/cover.png']
with zipfile.ZipFile(out/'relayguard-seven-screens.zip','w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
    for p in sorted((out/'screens').glob('*.png')):z.write(p,p.name)
with zipfile.ZipFile(out/'relayguard-wave2-submission.zip','w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
    for p in files:z.write(p,p.relative_to(out))
oldzip=root/'output/submission';oldzip.mkdir(exist_ok=True)
shutil.copy2(out/'relayguard-wave2-submission.zip',oldzip/'relayguard-wave2-submission.zip')
checks={p.relative_to(root).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
(out/'delivery-manifest.json').write_text(json.dumps({'sourceCommit':'f74c1a4','delivery':'2026-11-05','files':checks},indent=2)+'\n')
print(f'Packaged {len(files)} judge-facing files.')
