"""Author seven independent submission images and a vector-text pitch deck.

Inputs are product captures from capture-hackathon.mjs. All coordinates are
explicit design units; screenshots retain their actual states and proportions.
"""
from pathlib import Path
import json, shutil
from PIL import Image, ImageOps, ImageDraw, ImageFont
import fitz
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from submission_fonts import font_paths

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/hackathon'; CAP=OUT/'captures'; TMP=ROOT/'tmp/hackathon-design'
for d in [OUT/'screens',OUT/'deck',TMP,OUT/'video'] : d.mkdir(parents=True,exist_ok=True)
# Focus crops shared by the film; never alter the underlying receipt state.
Image.open(CAP/'evidence.png').crop((0,790,2368,1570)).save(CAP/'receipt-cards.png')
Image.open(CAP/'treasury.png').crop((480,655,2820,1530)).save(CAP/'treasury-crop.png')
regular,bold=font_paths(ROOT)
pdfmetrics.registerFont(TTFont('Manrope',str(regular)))
pdfmetrics.registerFont(TTFont('Manrope-Bold',str(bold)))
BG='#0c1117'; PANEL='#111820'; TEXT='#e8edf3'; MUTED='#a8b4c1'; LIME='#b7f566'; LINE='#293744'; ORANGE='#f0a35d'

class Board:
    def __init__(self,path,h=1600):
        self.h=h; self.c=canvas.Canvas(str(path),pagesize=(2400,h)); self.c.setTitle('RelayGuard | Mezo Wave 2'); self.c.setAuthor('RelayGuard / Praise')
    def box(self,x,y,w,h,color=PANEL,stroke=None,r=0):
        c=self.c; c.setFillColor(HexColor(color)); c.setStrokeColor(HexColor(stroke or color)); c.setLineWidth(2)
        c.roundRect(x,self.h-y-h,w,h,r,fill=1,stroke=bool(stroke))
    def line(self,x,y,w,color=LINE):
        self.c.setStrokeColor(HexColor(color)); self.c.setLineWidth(2); self.c.line(x,self.h-y,x+w,self.h-y)
    def text(self,s,x,y,size=36,color=TEXT,b=True):
        self.c.setFillColor(HexColor(color)); self.c.setFont('Manrope-Bold' if b else 'Manrope',size)
        self.c.drawString(x,self.h-y-size*.88,s)
    def para(self,s,x,y,w,size=36,color=MUTED,b=False,leading=1.43):
        lines=[]
        for paragraph in s.split('\n'):
            words=paragraph.split(); line=''
            for word in words:
                test=(line+' '+word).strip()
                if pdfmetrics.stringWidth(test,'Manrope-Bold' if b else 'Manrope',size)>w and line: lines.append(line);line=word
                else: line=test
            lines.append(line)
        for i,line in enumerate(lines):self.text(line,x,y+i*size*leading,size,color,b)
        return y+len(lines)*size*leading
    def image(self,name,x,y,w,h=None,crop=None,frame=True):
        im=Image.open(CAP/name) if isinstance(name,str) else name
        if crop:im=im.crop(crop)
        if h is None:h=w*im.height/im.width
        scale=min(w/im.width,h/im.height); iw,ih=im.width*scale,im.height*scale
        xx=x+(w-iw)/2; yy=y+(h-ih)/2
        if frame:self.box(xx-3,yy-3,iw+6,ih+6,LINE,r=10)
        self.c.drawImage(ImageReader(im),xx,self.h-yy-ih,iw,ih,mask='auto')
        return xx,yy,iw,ih
    def base(self,n,label,total=7,state='Mezo Testnet',h=None):
        self.box(0,0,2400,self.h,BG)
        self.box(88,72,12,44,LIME)
        self.text('RelayGuard',122,70,41)
        self.text('MEZO / WAVE 2',1870,82,25,MUTED)
        self.line(88,156,2224)
        self.line(88,self.h-91,2224)
        self.text(label.upper(),88,self.h-62,23,MUTED)
        self.text(state,1080,self.h-62,23,MUTED,False)
        self.text(f'{n:02} / {total:02}',2200,self.h-62,23,MUTED)
        self.c.linkURL('https://relayguard.vercel.app', (88,20,850,65),relative=0)
    def tag(self,s,x,y,color=LIME):self.text(s.upper(),x,y,26,color)
    def item(self,n,title,body,x,y,w=660):
        self.tag(n,x,y);self.text(title,x+70,y-4,35); self.para(body,x+70,y+55,w-70,29)
    def finish(self):self.c.save()

names=['merchant-workspace','invoice-creation','mobile-checkout','paid-api','treasury','policy-controls','settlement-evidence']
pdfpaths=[]
for i,name in enumerate(names):
    path=TMP/f'{i+1:02}-{name}.pdf';pdfpaths.append(path); b=Board(path);b.base(i+1,name.replace('-',' '),state='Demo account / Mezo Testnet' if i<4 else 'Mezo Testnet / read-only')
    if i==0:
        b.tag('01 / Merchant workspace',88,220);b.para('Your wallet.\nYour payments.',88,288,780,96,TEXT,True,1.15)
        b.para('A practical workspace for selling digital goods and accepting MUSD on Mezo.',88,560,760,39)
        b.item('01','Connect an account','Keep invoices and orders together.',88,820,760)
        b.item('02','Verify a receiving wallet','Prove ownership with one signature.',88,1015,760)
        b.item('03','Receive funds directly','Customers pay the merchant wallet.',88,1210,760)
        b.image('merchant.png',940,240,1370,1165,crop=(460,170,2835,1565))
    elif i==1:
        b.tag('02 / Invoice creation',88,220);b.para('One invoice.\nReady to share.',88,290,1100,94,TEXT,True,1.16)
        b.para('Set the product, exact MUSD amount and link expiry. Share a checkout link or QR code.',88,565,1050,39)
        b.line(88,790,950)
        b.text('1.00',88,855,140,LIME);b.text('MUSD',435,938,43)
        b.text('24 hours',88,1070,67);b.para('A clear price and a defined payment window.',88,1170,900,34)
        b.image('invoice-created.png',1210,220,1060,1200)
    elif i==2:
        b.tag('03 / Buyer checkout',88,220);b.para('Made for the\ncustomer’s phone.',88,290,1230,96,TEXT,True,1.15)
        b.para('Review the order before authorizing a payment. No buyer account required.',88,565,1100,40)
        b.item('01','Review the details','Amount, receiving address and Mezo network.',88,800,1100)
        b.item('02','Confirm wallet ownership','A signature starts the checkout session.',88,1000,1100)
        b.item('03','Authorize the payment','A separate wallet confirmation transfers MUSD.',88,1200,1100)
        b.box(1565,220,625,1240,'#05080c',LINE,54)
        b.image('checkout.png',1590,245,575,1190,frame=False)
    elif i==3:
        b.tag('04 / Developer payments',88,215);b.text('Turn an API route into a paid product.',88,280,84)
        b.para('Register the route and price, then protect it with the Express adapter.',88,405,2150,39)
        b.image('api.png',88,535,1430,815)
        for j,(head,copy) in enumerate([('402 challenge','An unpaid request receives payment requirements.'),('Signed authorization','The buyer approves the exact MUSD payment.'),('Settle, then respond','The API releases its response after settlement.')]):b.item(f'0{j+1}',head,copy,1650,600+j*260,650)
    elif i==4:
        b.tag('05 / Operator treasury',88,220);b.text('Mezo context behind every decision.',88,282,82)
        b.para('MUSD balance, BTC gas and collateral health, together in the operator console.',88,405,2170,39)
        b.image('treasury.png',88,555,2224,850,crop=(480,655,2820,1530))
        b.tag('Live deployment snapshot / 5 Nov 2026',88,1400)
    elif i==5:
        b.tag('06 / Protocol-aware policy',88,220);b.text('When risk changes, permission changes.',88,282,80)
        b.para('Controlled scenarios exercise the real policy functions without broadcasting a transaction.',88,405,2160,37)
        b.image('policy-review.png',88,570,1460,830)
        for j,(n,title,copy,col) in enumerate([('180%','Healthy','Normal policy evaluation.',LIME),('125%','Review required','Below the 150% app threshold.',ORANGE),('109%','Spending blocked','Below the 110% protocol minimum.','#ff7777')]):
            y=570+j*265;b.text(n,1680,y,72,col);b.text(title,1680,y+95,34);b.para(copy,1680,y+150,600,28)
        b.text('Unavailable protocol reads pause MUSD authorization.',88,1410,29,MUTED)
    else:
        b.tag('07 / Settlement evidence',88,220);b.text('A payment is more than a hash.',88,282,88)
        b.para('The verifier checks the receipt and the matching MUSD Transfer event.',88,405,2200,39)
        b.image('evidence.png',88,560,2224,760,crop=(0,790,2368,1590))
        for j,(head,copy) in enumerate([('Payer','Match the checkout wallet.'),('Recipient','Match the merchant wallet.'),('Amount','Match the exact atomic value.')]):
            x=88+j*755;b.line(x,1350,680);b.text(head,x,1380,32,LIME);b.text(copy,x,1430,28,MUTED,False)
    b.finish()
    doc=fitz.open(path);doc[0].get_pixmap(matrix=fitz.Matrix(1,1),alpha=False).save(OUT/'screens'/f'{i+1:02}-{name}.png');doc.close()

# A separate pitch deck: vector typography, actual interface assets, live links.
deck=OUT/'deck/relayguard-wave2.pdf';b=Board(deck,h=1350)
def page(n,label):b.base(n,label,total=10,state='relayguard.vercel.app / Mezo Testnet')
def title(kicker,heading,body=''):
    b.tag(kicker,88,215);b.para(heading,88,280,2200,83,TEXT,True,1.16)
    if body:b.para(body,88,410,2200,36)
def nextpage():b.c.showPage()

page(1,'MUSD payments with verifiable settlement')
b.tag('Merchant checkout + paid APIs',88,245)
b.para('Sell in MUSD.\nKnow what\nwas paid.',88,320,1120,116,TEXT,True,1.1)
b.para('Merchant payments and x402 API access on Mezo, with inspectable settlement and protocol-aware treasury policy.',88,790,1040,40)
b.text('Built by Praise',88,1110,30,MUTED)
b.image('checkout.png',1610,230,465,995)
nextpage()
page(2,'The problem')
title('01 / The merchant’s missing layer','A token transfer does not identify an order.')
b.para('Digital merchants need a payment workflow: a price, a customer, an expiry and a reliable decision about what to fulfil.',88,455,1840,47)
for j,(num,head,copy) in enumerate([('01','Request','Create an exact, expiring payment request.'),('02','Reconcile','Tie the transfer to the buyer and merchant.'),('03','Fulfil','Release an order or API response after verification.')]):
    x=88+j*755;b.line(x,710,675);b.text(num,x,755,82,LIME);b.text(head,x,885,45);b.para(copy,x,970,650,35)
nextpage()
page(3,'Merchant and buyer experience')
title('02 / Product','Create a link. Let the customer pay.')
b.image('invoice-created.png',88,465,650,735)
b.image('checkout.png',980,455,345,740)
b.item('01','Merchant sets the terms','Product, exact MUSD price and expiry.',1530,530,740)
b.item('02','Customer reviews and signs','The checkout makes the destination and amount visible.',1530,760,740)
b.item('03','Funds arrive directly','The merchant remains the receiving wallet.',1530,1010,740)
b.text('Demo account',88,1215,24,MUTED)
nextpage()
page(4,'Paid API access')
title('03 / Developer experience','The same payment discipline, per request.')
b.image('api.png',88,470,1450,755)
for j,(head,copy) in enumerate([('Register','Define a paid route and MUSD price.'),('Challenge','HTTP 402 returns payment requirements.'),('Settle','Signed authorization is settled before a response is released.')]):b.item(f'0{j+1}',head,copy,1660,535+j*235,640)
nextpage()
page(5,'Mezo integration')
title('04 / Why Mezo','MUSD is the payment asset. Mezo informs risk.')
rows=[('Settlement','Canonical MUSD on Mezo Testnet','ERC-20 transfers for invoices; x402 signed authorization for APIs.'),('Protocol reads','Trove state + price feed','BTC collateral, debt and collateral ratio inform policy.'),('Treasury policy','Evaluate before authorization','Human review, spending blocks and unavailable-read handling.')]
for j,(k,h,p) in enumerate(rows):
    y=485+j*240;b.line(88,y,2224);b.text(k,88,y+48,33,LIME);b.text(h,680,y+35,44);b.para(p,680,y+107,1550,33)
b.text('Chain 31611 / BTC gas / MUSD payments',88,1210,27,MUTED)
nextpage()
page(6,'Settlement on chain')
title('05 / Integration evidence','Historical Testnet payments. Public verification.')
b.image('evidence.png',88,485,2224,710,crop=(0,790,2368,1590))
b.text('Receipt status remains visible when an RPC read is unavailable.',88,1200,29,MUTED)
b.c.linkURL('https://relayguard.vercel.app/review#proof',(88,100,2312,800),relative=0)
nextpage()
page(7,'Policy controls')
title('06 / Risk boundaries','A clear boundary between permission and risk.')
b.image('policy-review.png',88,470,1440,735)
for j,(head,copy,col) in enumerate([('150% app threshold','125% collateral requires human approval.',ORANGE),('110% protocol minimum','109% collateral blocks spending.','#ff7777'),('Unavailable reads','Pause MUSD authorization when context is missing.',MUTED)]):
    y=510+j*230;b.text(head,1660,y,33,col);b.para(copy,1660,y+65,620,31)
b.text('Controlled scenarios / real policy functions / no transaction broadcast',88,1215,25,MUTED)
nextpage()
page(8,'Technical implementation')
title('07 / Engineering','Verification belongs on the server.')
for j,(head,copy) in enumerate([('Exact settlement checks','Receipt success, canonical token, payer, recipient and atomic amount.'),('Authenticated merchant operations','Session validation, wallet ownership signatures and merchant-scoped invoices.'),('Replay and expiry handling','Payment attempts are bounded by invoice state and authorization validity.'),('Tested policy boundaries','63 automated tests cover settlement, authentication and policy behavior.')]):
    x=88+(j%2)*1170;y=490+(j//2)*355;b.line(x,y,1060);b.text(head,x,y+48,39);b.para(copy,x,y+130,1030,35)
nextpage()
page(9,'Business and validation')
title('08 / First market','Start with sellers who already want MUSD.')
b.para('API sellers and digital merchants need payment links, clear reconciliation and a small integration surface.',88,470,1030,47)
b.box(1350,475,960,680)
b.tag('Next milestone',1420,535);b.text('3 design partners',1420,610,70)
b.para('Measure time to first payment, checkout completion and repeat payment activity.',1420,745,800,36)
b.line(1420,950,800);b.para('$19/month merchant workspace: a pricing hypothesis to validate in the pilot.',1420,995,800,32)
b.text('Pilot objective / first payment to repeat usage',88,1195,26,MUTED)
nextpage()
page(10,'Explore RelayGuard')
b.tag('RelayGuard / Mezo Wave 2',88,245)
b.para('From a payment request\nto a verifiable result.',88,330,2180,112,TEXT,True,1.17)
b.para('MUSD checkout. Paid APIs. Protocol-aware policy.',88,680,2100,46,MUTED)
b.line(88,850,2224)
b.text('Explore the product',88,925,30,LIME);b.text('relayguard.vercel.app',88,990,56)
b.text('Inspect the implementation',1260,925,30,LIME);b.text('github.com/Reinasboo/relayguard',1260,1000,38)
b.c.linkURL('https://relayguard.vercel.app',(88,280,1130,430),relative=0)
b.c.linkURL('https://github.com/Reinasboo/relayguard',(1260,280,2300,430),relative=0)
b.text('Praise / Builder',88,1160,31,MUTED)
b.finish()

doc=fitz.open(deck)
for i,p in enumerate(doc):p.get_pixmap(matrix=fitz.Matrix(.6,.6),alpha=False).save(OUT/'deck'/f'page-{i+1:02}.png')
doc.close()
shutil.copy2(deck,ROOT/'public/submission/relayguard-wave2.pdf')
(ROOT/'output/pdf').mkdir(exist_ok=True);shutil.copy2(deck,ROOT/'output/pdf/relayguard-wave2.pdf')

def sheet(files,target,cols,width):
    thumbs=[]
    for f in files:
        im=Image.open(f).convert('RGB');im.thumbnail((width,round(width*2/3)))
        tile=Image.new('RGB',(width+30,round(width*2/3)+60),BG);tile.paste(im,((tile.width-im.width)//2,10));
        ImageDraw.Draw(tile).text((15,tile.height-32),f.stem,fill=TEXT,font=ImageFont.truetype(str(regular),17));thumbs.append(tile)
    rows=(len(thumbs)+cols-1)//cols
    canvasim=Image.new('RGB',(cols*thumbs[0].width,rows*thumbs[0].height),BG)
    for i,t in enumerate(thumbs):canvasim.paste(t,((i%cols)*t.width,(i//cols)*t.height))
    canvasim.save(target)
sheet(sorted((OUT/'screens').glob('*.png')),OUT/'screens-contact-sheet.jpg',3,600)
sheet(sorted((OUT/'deck').glob('page-*.png')),OUT/'deck-contact-sheet.jpg',2,720)
print('Created seven 2400x1600 images and ten-page pitch deck.')
