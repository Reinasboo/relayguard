"""Validate delivered media, decode the MP4, and extract actual encoded cut frames."""
from pathlib import Path
import json, subprocess, zipfile
from PIL import Image, ImageDraw, ImageFont
import pymupdf
from submission_fonts import font_paths
root=Path(__file__).resolve().parents[1];out=root/'output/hackathon';video=out/'video/relayguard-demo.mp4'
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout
screens=sorted((out/'screens').glob('*.png'));assert len(screens)==7
for p in screens:
    with Image.open(p) as im:assert im.size==(2400,1600),(p,im.size)
d=pymupdf.open(out/'deck/relayguard-wave2.pdf');assert len(d)==10
for i,p in enumerate(d):
    assert len(p.get_text())>100
    for block in p.get_text('blocks'):
        assert block[0]>=0 and block[1]>=0 and block[2]<=p.rect.width+1 and block[3]<=p.rect.height+1,(i,block[:4])
links=sum(len(p.get_links()) for p in d);d.close()
probe=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(x for x in probe['streams'] if x['codec_type']=='video');a=next(x for x in probe['streams'] if x['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1')
assert abs(float(probe['format']['duration'])-120)<.1
assert v['codec_name']=='h264' and a['codec_name']=='aac'
run(['ffmpeg','-hide_banner','-v','error','-i',str(video),'-f','null','-'])
timings=json.loads((out/'audio/timings.json').read_text());assert timings['duration']<120
for c in timings['captions']:assert 0<=c['start']<c['end']<120
qc=out/'video/encoded-review';qc.mkdir(exist_ok=True)
moments=[(f'chapter-{i+1:02}',c['start']+3) for i,c in enumerate(timings['chapters'])]
moments += [(f'cut-{i:02}-{side}',max(0,c['start']+delta)) for i,c in enumerate(timings['chapters'][1:],1) for side,delta in [('before',-.1),('after',.8)]]
moments += [('invoice-created',19),('api-reference',58.5),('policy-blocked',81.5),('policy-offline',85),('closing-hold',118)]
for name,t in moments:run(['ffmpeg','-hide_banner','-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(qc/f'{name}.png')])
files=sorted(qc.glob('*.png'));regular,_=font_paths(root)
sheet=Image.new('RGB',(1920,((len(files)+2)//3)*400),'#0c1117')
for i,p in enumerate(files):
    im=Image.open(p);im.thumbnail((620,349));x=(i%3)*640;y=(i//3)*400;sheet.paste(im,(x+10,y+10));ImageDraw.Draw(sheet).text((x+10,y+365),p.stem,fill='#a8b4c1',font=ImageFont.truetype(str(regular),18))
sheet.save(out/'video/encoded-review-contact-sheet.jpg')
with zipfile.ZipFile(out/'relayguard-wave2-submission.zip') as z:
    assert z.testzip() is None;assert len(z.namelist())==11
report={'screens':7,'dimensions':[2400,1600],'deckPages':10,'pdfLinks':links,'clippedTextBlocks':0,'video':{'seconds':float(probe['format']['duration']),'width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'codecs':[v['codec_name'],a['codec_name']],'decode':'passed'},'captions':len(timings['captions']),'encodedReviewFrames':len(moments),'archive':'passed'}
(out/'verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
