# -*- coding: utf-8 -*-
import os,re,glob
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate,PageTemplate,Frame,Paragraph,Spacer,Table,TableStyle,
    PageBreak,NextPageTemplate,KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import datetime
DF="/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("DJ",DF+"DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DJ-B",DF+"DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DJ-O",DF+"DejaVuSans-Oblique.ttf"))
pdfmetrics.registerFontFamily("DJ",normal="DJ",bold="DJ-B",italic="DJ-O",boldItalic="DJ-B")
NAVY=colors.HexColor("#1B2A4E");GREEN=colors.HexColor("#8BC34A");GREEND=colors.HexColor("#5f9226")
BLUE=colors.HexColor("#0099E5");SOFT=colors.HexColor("#f4f6fa");LINE=colors.HexColor("#d8dee8")
INK=colors.HexColor("#1b2330");MUT=colors.HexColor("#5c6675")
def st(n,**k):
    b=dict(fontName="DJ",fontSize=10,leading=14.5,textColor=INK); b.update(k); return ParagraphStyle(n,**b)
S={"h1":st("h1",fontName="DJ-B",fontSize=18,leading=22,textColor=NAVY,spaceBefore=2,spaceAfter=2),
   "h2":st("h2",fontName="DJ-B",fontSize=13,leading=17,textColor=NAVY,spaceBefore=12,spaceAfter=3),
   "h3":st("h3",fontName="DJ-B",fontSize=11,leading=15,textColor=GREEND,spaceBefore=8,spaceAfter=2),
   "intro":st("intro",fontName="DJ-O",fontSize=9.5,leading=13.5,textColor=MUT,spaceAfter=4),
   "body":st("body",spaceAfter=4),"chk":st("chk",leading=16,leftIndent=2),
   "bul":st("bul",leading=14.5,leftIndent=12,bulletIndent=2),
   "cell":st("cell",fontSize=9,leading=12),"cellb":st("cellb",fontName="DJ-B",fontSize=9,leading=12,textColor=colors.white),
   "small":st("small",fontSize=8,leading=10.5,textColor=MUT)}
def esc(t):
    t=t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
    t=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',t)
    t=re.sub(r'(?<!\*)\*(?!\s)(.+?)\*',r'<i>\1</i>',t)
    t=t.replace("★",'<font color="#5f9226">★</font>')
    t=re.sub(r'\[(.+?)\]',r'<u><font color="#6da82f">[\1]</font></u>',t)
    return t
def callout(t,color=GREEN):
    tb=Table([[Paragraph(t,S["body"])]],colWidths=[6.5*inch])
    tb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),SOFT),("LINEBEFORE",(0,0),(0,-1),3,color),
        ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),
        ("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9)])); return tb
def mk_table(rows):
    hdr=rows[0]; body=rows[1:]
    ncol=len(hdr)
    data=[[Paragraph(esc(c),S["cellb"]) for c in hdr]]
    fill=any(all(c.strip()=="" for c in r[1:]) for r in body)  # blank cells => fillable
    for r in body:
        data.append([Paragraph(esc(c) if c.strip() else "&nbsp;",S["cell"]) for c in r])
    w=6.5/ncol
    t=Table(data,colWidths=[w*inch]*ncol,repeatRows=1)
    rh=[("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,SOFT])]
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),0.5,LINE),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),6 if fill else 5),
        ("BOTTOMPADDING",(0,0),(-1,-1),6 if fill else 5),("LEFTPADDING",(0,0),(-1,-1),6),
        ("RIGHTPADDING",(0,0),(-1,-1),6)]+rh)); return t

def parse_md(path, accent=GREEN):
    lines=open(path,encoding="utf-8").read().split("\n")
    fl=[]; i=0; title=None
    def flush_para(buf):
        if buf:
            fl.append(Paragraph(esc(" ".join(buf)),S["body"]))
    while i<len(lines):
        ln=lines[i].rstrip()
        if title is None and ln.startswith("# "):
            title=ln[2:].strip(); i+=1; continue
        if ln.strip()=="---": i+=1; continue
        if ln.startswith("> "):
            blk=[]
            while i<len(lines) and lines[i].startswith(">"):
                blk.append(lines[i].lstrip("> ").rstrip()); i+=1
            fl.append(callout(esc(" ".join(blk)),accent)); fl.append(Spacer(1,6)); continue
        if ln.startswith("|"):
            tb=[]
            while i<len(lines) and lines[i].lstrip().startswith("|"):
                row=[c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not re.match(r'^[\s:-]+$',"".join(row)): tb.append(row)
                i+=1
            if tb: fl.append(mk_table(tb)); fl.append(Spacer(1,6))
            continue
        if ln.startswith("### "): fl.append(Paragraph(esc(ln[4:]),S["h3"])); i+=1; continue
        if ln.startswith("## "): fl.append(Paragraph(esc(ln[3:]),S["h2"])); i+=1; continue
        if re.match(r'^\s*-\s+\[ \]\s+',ln):
            while i<len(lines) and re.match(r'^\s*-\s+\[ \]\s+',lines[i]):
                it=re.sub(r'^\s*-\s+\[ \]\s+','',lines[i].rstrip())
                fl.append(Paragraph("☐  "+esc(it),S["chk"])); i+=1
            continue
        if re.match(r'^\s*-\s+',ln):
            while i<len(lines) and re.match(r'^\s*-\s+',lines[i]) and "[ ]" not in lines[i]:
                it=re.sub(r'^\s*-\s+','',lines[i].rstrip())
                fl.append(Paragraph("•  "+esc(it),S["bul"])); i+=1
            continue
        if ln.startswith("*") and ln.endswith("*") and len(ln)>2:
            fl.append(Paragraph(esc(ln.strip("*")),S["intro"])); i+=1; continue
        if ln.strip()=="":
            i+=1; continue
        # paragraph (gather until blank)
        buf=[ln]; i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^\s*([-#>|]|\*[^*])',lines[i]) and not lines[i].startswith("## "):
            buf.append(lines[i].rstrip()); i+=1
        flush_para(buf)
    return title, fl

YEAR=datetime.date.today().year
def footer(c,doc):
    w,h=letter; c.saveState()
    c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(0.85*inch,0.62*inch,w-0.85*inch,0.62*inch)
    c.setFillColor(MUT); c.setFont("DJ",7.5)
    c.drawString(0.85*inch,0.44*inch,"The OBX Rental Owner's Operations Kit  ·  © %d OBX Lot Solutions"%YEAR)
    c.setFillColor(GREEND); c.drawString(0.85*inch,0.30*inch,"Need it done for you?  obxlotsolutions.com  ·  (252) 564-8717")
    c.setFillColor(MUT); c.drawRightString(w-0.85*inch,0.30*inch,"Page %d"%doc.page)
    c.restoreState()
def cover(c,doc,subtitle):
    w,h=letter; c.saveState()
    c.setFillColor(NAVY); c.rect(0,0,w,h,fill=1,stroke=0)
    c.setFillColor(GREEN); c.rect(0,h-2.05*inch,w,0.13*inch,fill=1,stroke=0)
    c.setFillColor(colors.white); c.setFont("DJ-B",30)
    c.drawString(0.9*inch,h-3.25*inch,"The OBX Rental")
    c.drawString(0.9*inch,h-3.85*inch,"Owner's Operations Kit")
    c.setFillColor(GREEN); c.setFont("DJ-B",12.5); c.drawString(0.9*inch,h-4.35*inch,subtitle)
    c.setFillColor(colors.HexColor("#cfd8e8")); c.setFont("DJ",11.5)
    for j,t in enumerate(["Six done-for-you templates built for the Outer Banks —","turnovers, guest welcome book, maintenance, storm prep,","vendors, and pricing. The system we wish every owner had."]):
        c.drawString(0.9*inch,h-(4.95+j*0.27)*inch,t)
    c.setFillColor(colors.white); c.setFont("DJ-B",11); c.drawString(0.9*inch,1.15*inch,"By OBX Lot Solutions")
    c.setFillColor(colors.HexColor("#cfd8e8")); c.setFont("DJ",9.5)
    c.drawString(0.9*inch,0.92*inch,"Outer Banks, NC  ·  (252) 564-8717  ·  obxlotsolutions.com")
    c.restoreState()

def doc_for(path,subtitle):
    doc=BaseDocTemplate(path,pagesize=letter,leftMargin=0.85*inch,rightMargin=0.85*inch,
        topMargin=0.8*inch,bottomMargin=0.8*inch,title="The OBX Rental Owner's Operations Kit",author="OBX Lot Solutions")
    fr=Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id="f")
    doc.addPageTemplates([PageTemplate(id="cover",frames=[fr],onPage=lambda c,d:cover(c,d,subtitle)),
                          PageTemplate(id="body",frames=[fr],onPage=footer)])
    return doc

files=sorted(glob.glob("kit-contents/*.md"), key=lambda p: int(re.match(r'(\d+)',os.path.basename(p)).group(1)))
def section_header(title,accent=GREEN):
    return [Paragraph(esc(title),S["h1"]),
            Table([[""]],colWidths=[1.6*inch],rowHeights=[3],style=TableStyle([("BACKGROUND",(0,0),(-1,-1),accent)])),
            Spacer(1,8)]

# ---- FULL combined master ----
def build_full():
    doc=doc_for("OBX-Rental-Owner-Kit.pdf","THE COMPLETE KIT — 7 COMPONENTS")
    story=[NextPageTemplate("body"),PageBreak()]
    # contents page
    story+=section_header("What's in this kit")
    story.append(Paragraph("Seven OBX-specific components. Print them, fill them in, and use them this season. Items marked <font color='#5f9226'>★</font> are the Outer Banks details most generic checklists miss.",S["body"]))
    story.append(Spacer(1,6))
    names=[]
    for p in files:
        t=open(p,encoding="utf-8").readline().lstrip("# ").strip(); names.append(t)
        story.append(Paragraph("→  <b>%s</b>"%esc(t),S["chk"]))
    story.append(Spacer(1,8))
    story.append(callout("This is an OBX Lot Solutions product. The advice is genuinely useful on its own — and when you'd rather not DIY, the same local team does the hands-on work. County tax/permit and insurance notes are starting points; verify current specifics with the county and your carrier.",GREEN))
    story.append(PageBreak())
    for idx,p in enumerate(files):
        accent=BLUE if "Tech-Ready" in p else GREEN
        title,fl=parse_md(p,accent)
        story+=section_header(title,accent)+fl
        story.append(PageBreak())
    doc.build(story)
    print("built OBX-Rental-Owner-Kit.pdf ;",len(files),"components")
# ---- SAMPLE (free lite = Turnover Checklist) ----
def build_sample():
    doc=doc_for("OBX-Rental-Owner-Kit-SAMPLE.pdf","FREE SAMPLE — TURNOVER CHECKLIST")
    story=[NextPageTemplate("body"),PageBreak()]
    title,fl=parse_md(files[0],GREEN)
    story+=section_header(title)+fl
    story.append(PageBreak())
    story+=section_header("What's in the full kit")
    story.append(Paragraph("This free sample is just the Turnover Checklist. The full <b>OBX Rental Owner's Operations Kit</b> adds:",S["body"]))
    for p in files[1:]:
        t=open(p,encoding="utf-8").readline().lstrip("# ").strip()
        story.append(Paragraph("✓  <b>%s</b>"%esc(t),S["chk"]))
    story.append(Spacer(1,10))
    story.append(callout("<b>Get the full kit:</b> The Kit <b>$29</b> · + Tech-Ready Guide <b>$39</b> · + 20-min local consult <b>$49</b>.  <b>Launch promo: $19</b> on the core kit. Instant download at obxlotsolutions.com.",GREEN))
    doc.build(story)
    print("built OBX-Rental-Owner-Kit-SAMPLE.pdf")
build_full(); build_sample()
