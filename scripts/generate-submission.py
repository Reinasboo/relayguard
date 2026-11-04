"""Build the Wave 2 PDF from current product captures and editable source.

Run npm run verify:ui first. Requires reportlab, Pillow and PyMuPDF.
"""
from pathlib import Path
import json
import shutil
from xml.sax.saxutils import escape
from PIL import Image
import fitz
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
CAPTURES = ROOT / "output/review"
OUT = ROOT / "output/pdf"
TMP = ROOT / "tmp/pdfs"
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)
for filename in ["01-review-desktop.png", "02-mezo-evidence.png", "03-policy-lab.png"]:
    if not (CAPTURES / filename).exists():
        raise SystemExit("Run npm run verify:ui before generating submission materials.")

fonts = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("RG", str(fonts / "arial.ttf")))
pdfmetrics.registerFont(TTFont("RG-Bold", str(fonts / "arialbd.ttf")))
pdfmetrics.registerFontFamily("RG", normal="RG", bold="RG-Bold")
W, H = 960, 540
BG, TEXT, MUTED, GREEN, LINE = map(HexColor, ["#0c1117", "#eef1e9", "#a2aca8", "#b7f566", "#334536"])
pdf = OUT / "relayguard-wave2.pdf"
c = canvas.Canvas(str(pdf), pagesize=(W, H))
c.setTitle("RelayGuard — Mezo Buildathon Wave 2")
c.setAuthor("RelayGuard / Praise")
c.setSubject("MUSD merchant payments, x402 API access and protocol-aware treasury policy")

def text(value, x, y, size=18, color=TEXT, bold=False):
    c.setFillColor(color)
    c.setFont("RG-Bold" if bold else "RG", size)
    c.drawString(x, y, value)

def para(value, x, y_top, width, size=16, color=MUTED, leading=None):
    p = Paragraph(value, ParagraphStyle("p", fontName="RG", fontSize=size,
        leading=leading or size*1.5, textColor=color))
    _, height = p.wrap(width, 1000)
    p.drawOn(c, x, y_top-height)
    return height

def rule(y, x=55, width=850):
    c.setStrokeColor(LINE)
    c.setLineWidth(.7)
    c.line(x, y, x+width, y)

def page(number, label):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    text("RelayGuard", 55, 505, 13, GREEN, True)
    text(label.upper(), 660, 506, 8, MUTED)
    rule(487)
    rule(34)
    text("MEZO TESTNET  /  WAVE 2 CANDIDATE  /  4 NOVEMBER 2026", 55, 18, 7.5, MUTED)
    text(f"{number:02d} / 09", 865, 18, 8, MUTED)

def title(lines, x=55, y=445, size=36):
    for index, line in enumerate(lines):
        text(line, x, y-index*(size*1.15), size, TEXT, True)

def link(label, url, x, y, size=9):
    text(label, x, y, size, GREEN)
    c.linkURL(url, (x, y-2, x+pdfmetrics.stringWidth(label, "RG", size), y+size+2), relative=0)

def shot(filename, x, y, width, height):
    c.drawImage(str(CAPTURES / filename), x, y, width, height, preserveAspectRatio=True, anchor="c", mask="auto")

page(1, "Access & Distribution")
title(["MUSD payments.", "Verified outcomes."], y=399, size=49)
para("Merchant orders and paid API access on Mezo.<br/>Direct settlement. Evidence a seller can inspect.", 55, 253, 420, 18)
text("Praise / Solo builder", 55, 133, 13, GREEN)
link("Existing public app: relayguard.vercel.app", "https://relayguard.vercel.app", 55, 92, 11)
text("Current reviewer build: npm run review", 55, 67, 10, MUTED)
hero = Image.open(CAPTURES / "01-review-desktop.png")
hero.crop((770, 160, 1360, 690)).save(TMP / "product-flow.png")
c.drawImage(str(TMP / "product-flow.png"), 535, 132, 360, 324, preserveAspectRatio=True, mask="auto")
text("Captured product UI. No illustrative transaction.", 545, 113, 8, MUTED)
c.showPage()

page(2, "The customer problem")
title(["A token transfer leaves", "an order to reconcile."], y=440, size=37)
para("The merchant needs to know which order was paid. The API seller needs to know when a response can be released.", 55, 330, 650, 18)
columns = [(55, "Exact intent", "Order, payer, asset, amount and recipient."),
           (350, "Buyer authorization", "Wallet transfer or signed x402 payment terms."),
           (645, "Verified outcome", "Receipt evidence before paid status or resource access.")]
for x, heading, body in columns:
    rule(230, x, 250)
    text(heading, x, 201, 20, GREEN)
    para(body, x, 176, 240, 16)
text("RelayGuard supplies the payment operations between those steps.", 55, 77, 17, TEXT)
c.showPage()

page(3, "The working product")
title(["One merchant. Two payment paths."], y=444, size=34)
# A focused crop preserves the actual product hero instead of shrinking a full page.
hero.crop((80, 170, 740, 650)).save(TMP / "hero-copy.png")
c.drawImage(str(TMP / "hero-copy.png"), 55, 100, 430, 313, preserveAspectRatio=True, mask="auto")
text("Customer checkout", 560, 376, 20, GREEN)
para("A shareable invoice or QR. The buyer signs the exact MUSD transfer directly to the merchant.", 560, 348, 333, 16)
text("Agent API access", 560, 247, 20, GREEN)
para("HTTP 402 terms. An x402 signature. Facilitator settlement before the API returns its resource.", 560, 220, 333, 16)
text("The merchant retains its storefront, API and wallet.", 55, 64, 15, TEXT)
c.showPage()

page(4, "Mezo integration")
title(["Mezo is inside the workflow."], y=444, size=36)
rows = [
    ("MUSD token", "Exact merchant settlement", "Canonical Testnet token. Receipt and Transfer event matching."),
    ("Mezo x402", "Paid software access", "Exact MUSD terms and facilitator settlement before delivery."),
    ("TroveManager + PriceFeed", "Treasury risk evidence", "Pinned protocol reads retained with the authorization decision."),
    ("BorrowerOperations", "Optional buyer onboarding", "Separate Testnet quote, debt review and wallet-signed borrow.")]
for i, (component, outcome, detail) in enumerate(rows):
    y = 365-i*68
    rule(y+21)
    text(component, 55, y, 16, GREEN, True)
    text(outcome, 395, y, 17, TEXT)
    text(detail, 395, y-23, 11, MUTED)
link("Mezo MUSD guide", "https://testnet.mezo.org/docs/developers/musd/", 55, 59)
link("Official x402 quickstart", "https://testnet.mezo.org/docs/developers/getting-started/musd-payments-x402/x402-quickstart/", 260, 59)
c.showPage()

page(5, "Protocol-aware spending")
title(["One request.", "Four risk outcomes."], y=439, size=30)
for y, ratio, decision in [(303,"180%", "Within configured limits"), (231,"125%", "Human approval required"), (159,"109%", "Payment blocked")]:
    text(ratio, 55, y, 31, GREEN)
    text(decision, 55, y-25, 13, TEXT)
text("RPC unavailable: pause MUSD authorization.", 55, 85, 12, MUTED)
shot("03-policy-lab.png", 390, 127, 520, 361)
para("Actual policy functions. Controlled examples. No funds move.<br/>Operator treasury policy is separate from buyer checkout.", 390, 102, 495, 11)
link("110% protocol minimum / 150% RelayGuard review buffer", "https://testnet.mezo.org/docs/developers/musd/", 390, 53, 8)
c.showPage()

page(6, "Independently checkable evidence")
title(["Two historical payments. One receiver."], y=445, size=31)
evidence = json.loads((CAPTURES / "live-evidence.json").read_text(encoding="utf-8"))
for x,payment in zip([55,510], evidence["payments"]):
    text(payment["label"],x,365,17,GREEN)
    text(payment["amount"],x,311,37,TEXT,True)
    text("RPC verified" if payment["verified"] else "Unverified now",x,275,13,GREEN)
    text(f"Receipt block {payment['blockNumber']}",x,246,12,MUTED)
    link("Inspect receipt on Mezo Explorer",f"https://explorer.test.mezo.org/tx/{payment['hash']}",x,210,11)
rule(181)
text("Exact token event match",55,151,15,TEXT,True)
text(f"Payer: {evidence['payer']}",55,119,11,MUTED)
text(f"Merchant: {evidence['merchant']}",55,97,11,MUTED)
text("Canonical MUSD + exact amount + expected payer and merchant",510,140,11,MUTED)
text(f"Rechecked at Mezo Testnet block {evidence['blockNumber']}",510,112,11,MUTED)
text("Historical transactions. Fresh RPC verification on capture.",55,57,10,MUTED)
c.showPage()

page(7, "Engineering improvements")
title(["Stronger boundaries.", "Recoverable payment attempts."], y=440, size=34)
rows = [
    ("Treasury access", "An explicit operator role protects the shared signer."),
    ("Payer identity", "An expiring invoice-bound signature proves wallet ownership."),
    ("Checkout mutations", "Authorization-bound sessions protect submit and release."),
    ("Rejection and interruption", "Fresh attempts can retry. Stored hashes let submit/verify repair state."),
    ("Exact amounts", "Excess decimal precision is rejected rather than rounded.")]
for i,(heading,detail) in enumerate(rows):
    y=326-i*46
    rule(y+17)
    text(heading,55,y,14,GREEN)
    text(detail,300,y,12,TEXT)
para("HTTP regression tests use the real app and SQLite stores, with authentication and RPC services mocked. Browser checks cover 390, 768 and 1440 pixel layouts.",55,83,800,11)
c.showPage()

page(8, "Product and business")
title(["A focused first market.", "A measurable pilot."], y=442, size=38)
text("API sellers and digital merchants",55,313,21,GREEN)
para("Already using MUSD. Need verifiable orders and paid access. Keep their storefront and receiving wallet.",55,280,405,18)
text("$19 / month",55,158,28,TEXT,True)
para("Proposed operations tier after free pilots.<br/>No platform fee, revenue or paying customers claimed today.",55,124,410,12)
text("3 design partners",560,312,30,GREEN)
para("Next validation gate",560,273,320,15)
for y,heading,body in [(217,"Activation", "Time to the first verified payment"),(154,"Reliability", "Completed checkouts and support issues"),(91,"Retention", "Repeat weekly use and willingness to pay")]:
    text(heading,560,y,15,TEXT,True)
    text(body,560,y-23,11,MUTED)
c.showPage()

page(9, "The next milestone")
title(["Make MUSD usable.", "Make payments accountable."],y=417,size=42)
para("The current build connects Mezo liquidity to useful transactions. The next milestone is repeat merchant use.",55,286,650,19)
link("Existing public app: relayguard.vercel.app", "https://relayguard.vercel.app",55,187,14)
text("Review this revision locally: npm run review",55,150,14,GREEN)
para("Before the final submission: deploy this revision, apply its access-control migration, complete a real-wallet check and publish the narrated demo.",55,107,820,12)
link("Deadline check: AKINDO widget says Nov 13; written schedule says Nov 15. Confirm before submitting.", "https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10",55,51,8)
c.showPage()
c.save()

public = ROOT / "public/submission"
public.mkdir(parents=True, exist_ok=True)
shutil.copyfile(pdf, public / pdf.name)
document = fitz.open(pdf)
for i,page_image in enumerate(document):
    page_image.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(TMP/f"slide-{i+1:02}.png")
assert len(document)==9
assert all(page.get_text().strip() for page in document)
print(json.dumps({"pdf":str(pdf),"pages":len(document),"rendered":str(TMP),"bytes":pdf.stat().st_size}))
