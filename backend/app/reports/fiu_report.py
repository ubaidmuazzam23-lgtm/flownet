# backend/app/reports/fiu_report.py
"""
FlowNet AI · Suspicious Activity Investigation Report
Forensic-style investigation report (not a checkbox STR form).

Structure:
  Cover / classification bar
  Subject card
  1. Investigation Summary       (LLM prose)
  2. Subject Profile             (KYC table)
  3. Detection Methodology       (LLM prose)
  4. Findings                    (LLM-generated list, structured)
      4.1 / 4.2 / 4.3 ... each with Observation / Evidence table /
      Pattern Match / Behavioral Anomaly / Severity / Investigative Lead
  5. Financial Activity Analysis (LLM prose + KPI grid)
  6. Counterparty Network        (table + LLM analysis)
  7. Risk Determination          (LLM prose + severity badge)
  8. Recommended Investigative Actions (numbered list)
  Exhibit A: Full transaction ledger
  Exhibit B: Model output
"""
from __future__ import annotations
import os
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    Table, TableStyle, KeepTogether, PageBreak,
)

# ============================================================================
# Fonts — Unicode for ₹
# ============================================================================
_FONT = "Helvetica"
_FONT_B = "Helvetica-Bold"
_FONT_I = "Helvetica-Oblique"

def _register_fonts():
    global _FONT, _FONT_B, _FONT_I
    candidates = [
        ("DejaVuSans",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
        ("DejaVuSans",
         "/Library/Fonts/DejaVuSans.ttf",
         "/Library/Fonts/DejaVuSans-Bold.ttf",
         "/Library/Fonts/DejaVuSans-Oblique.ttf"),
        ("DejaVuSans",
         "/opt/homebrew/share/fonts/DejaVuSans.ttf",
         "/opt/homebrew/share/fonts/DejaVuSans-Bold.ttf",
         "/opt/homebrew/share/fonts/DejaVuSans-Oblique.ttf"),
    ]
    for name, r, b, i in candidates:
        if os.path.exists(r):
            try:
                pdfmetrics.registerFont(TTFont(name, r))
                _FONT = name
                if b and os.path.exists(b):
                    pdfmetrics.registerFont(TTFont(name + "-Bold", b)); _FONT_B = name + "-Bold"
                else: _FONT_B = name
                if i and os.path.exists(i):
                    pdfmetrics.registerFont(TTFont(name + "-Italic", i)); _FONT_I = name + "-Italic"
                else: _FONT_I = name
                return
            except Exception:
                continue

_register_fonts()

# ============================================================================
# Palette — forensic / professional
# ============================================================================
INK = colors.HexColor("#0A0F1A")       # near-black navy text
SLATE = colors.HexColor("#2B3441")     # secondary text
ASH = colors.HexColor("#6B7380")       # tertiary text
ASH_LIGHT = colors.HexColor("#9CA3AF")
HAIRLINE = colors.HexColor("#E2E5EA")  # very subtle table lines
SOFT_BG = colors.HexColor("#F7F8FA")
NAVY = colors.HexColor("#1F3A5F")      # accent
CRIT = colors.HexColor("#9B1C1C")      # severity high
HIGH = colors.HexColor("#B25309")
MED = colors.HexColor("#946800")
LOW = colors.HexColor("#3F6212")


def _styles():
    base = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName=_FONT_B,
                             fontSize=22, leading=26, textColor=INK, spaceAfter=2),
        "subtitle": ParagraphStyle("subtitle", parent=base["Normal"], fontName=_FONT,
                                   fontSize=9.5, leading=13, textColor=SLATE),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=_FONT_B,
                             fontSize=13, leading=16, textColor=INK,
                             spaceBefore=14, spaceAfter=6),
        "h3": ParagraphStyle("h3", parent=base["Heading3"], fontName=_FONT_B,
                             fontSize=11, leading=14, textColor=INK,
                             spaceBefore=8, spaceAfter=4),
        "finding_title": ParagraphStyle("finding_title", parent=base["Heading3"], fontName=_FONT_B,
                                        fontSize=11, leading=14, textColor=INK,
                                        spaceBefore=10, spaceAfter=5),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName=_FONT,
                               fontSize=10, leading=14.5, textColor=INK,
                               spaceAfter=5, alignment=4),  # justified
        "label": ParagraphStyle("label", parent=base["Normal"], fontName=_FONT_B,
                                fontSize=8, leading=11, textColor=NAVY,
                                textTransform="uppercase"),
        "value": ParagraphStyle("value", parent=base["Normal"], fontName=_FONT,
                                fontSize=9.5, leading=13, textColor=INK),
        "kv_label": ParagraphStyle("kv_label", parent=base["Normal"], fontName=_FONT_B,
                                   fontSize=8.5, leading=12, textColor=ASH),
        "kv_value": ParagraphStyle("kv_value", parent=base["Normal"], fontName=_FONT,
                                   fontSize=9.5, leading=13, textColor=INK),
        "small": ParagraphStyle("small", parent=base["Normal"], fontName=_FONT,
                                fontSize=8, leading=11, textColor=ASH),
        "tiny": ParagraphStyle("tiny", parent=base["Normal"], fontName=_FONT_I,
                               fontSize=7.5, leading=10, textColor=ASH_LIGHT),
        "kpi_v": ParagraphStyle("kpi_v", parent=base["Normal"], fontName=_FONT_B,
                                fontSize=12, leading=14, textColor=INK, alignment=1),
        "kpi_l": ParagraphStyle("kpi_l", parent=base["Normal"], fontName=_FONT,
                                fontSize=7.5, leading=9.5, textColor=ASH, alignment=1),
        "cover_label": ParagraphStyle("cover_label", parent=base["Normal"], fontName=_FONT,
                                      fontSize=8, leading=10, textColor=ASH),
        "cover_value": ParagraphStyle("cover_value", parent=base["Normal"], fontName=_FONT_B,
                                      fontSize=10, leading=12, textColor=INK),
        "footer": ParagraphStyle("footer", parent=base["Normal"], fontName=_FONT_I,
                                 fontSize=7.5, leading=10, textColor=ASH),
    }


# ============================================================================
# Helpers
# ============================================================================
def _safe(v) -> str:
    if v is None: return "—"
    s = str(v).strip()
    return s if s else "—"


def _inr(n) -> str:
    if n is None: return "—"
    try: return f"INR {float(n):,.2f}"
    except: return "—"


def _sev_color(s: str) -> colors.Color:
    s = (s or "").strip().lower()
    if "critical" in s: return CRIT
    if "high" in s: return HIGH
    if "medium" in s or "moderate" in s: return MED
    if "low" in s: return LOW
    return SLATE


# ============================================================================
# Cover & subject card
# ============================================================================
def _classification_bar(styles):
    t = Table([[Paragraph("CONFIDENTIAL · SUSPICIOUS ACTIVITY INVESTIGATION", styles["cover_label"])]],
              colWidths=[175 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), INK),
        ("TEXTCOLOR", (0,0), (-1,-1), colors.white),
        ("ALIGN", (0,0), (-1,-1), "LEFT"),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    return t


def _cover_block(report: Dict[str, Any], styles):
    su = report.get("subject", {})
    parts = []
    parts.append(Paragraph("Suspicious Activity Investigation", styles["h1"]))
    parts.append(Paragraph(
        report.get("kind", "Anti-Money-Laundering Investigation"),
        styles["subtitle"]))
    parts.append(Spacer(1, 6 * mm))

    # subject card
    holder = _safe(su.get("holder_name"))
    aid = _safe(su.get("account_id"))
    occ = _safe(su.get("occupation"))
    branch = _safe(su.get("branch_name"))
    income = _inr(su.get("declared_income")) if su.get("declared_income") else "—"
    opened = _safe(su.get("opening_date"))[:10] if su.get("opening_date") else "—"

    card_body = Table([
        [Paragraph(holder, ParagraphStyle("name", fontName=_FONT_B, fontSize=14,
                                          leading=17, textColor=INK)),
         Paragraph("ACCOUNT", styles["cover_label"])],
        [Paragraph(f"{occ} · {branch}", styles["subtitle"]),
         Paragraph(aid, ParagraphStyle("acct", fontName=_FONT_B, fontSize=11,
                                       leading=14, textColor=NAVY, alignment=2))],  # right
        [Paragraph(f"<b>Declared income:</b> {income} &nbsp;·&nbsp; "
                   f"<b>Account opened:</b> {opened}", styles["small"]), ""],
    ], colWidths=[110*mm, 65*mm])
    card_body.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEABOVE", (0,0), (-1,0), 0.6, INK),
        ("LINEBELOW", (0,-1), (-1,-1), 0.6, INK),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING", (0,0), (-1,-1), 0),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("SPAN", (0,2), (-1,2)),
    ]))
    parts.append(card_body)
    parts.append(Spacer(1, 4 * mm))

    # meta strip: reference, date, classification, severity preview
    sev = report.get("severity") or "—"
    meta = Table([
        [Paragraph("REFERENCE", styles["cover_label"]),
         Paragraph("ISSUED", styles["cover_label"]),
         Paragraph("DETECTION", styles["cover_label"]),
         Paragraph("PRELIMINARY SEVERITY", styles["cover_label"])],
        [Paragraph(report.get("report_id","—"), styles["cover_value"]),
         Paragraph(datetime.utcnow().strftime("%d %B %Y · %H:%M UTC"), styles["cover_value"]),
         Paragraph(report.get("kind","—"), styles["cover_value"]),
         Paragraph(f'<font color="{_sev_color(sev).hexval()}">{sev.upper()}</font>',
                   ParagraphStyle("sevv", fontName=_FONT_B, fontSize=10, leading=12))],
    ], colWidths=[44*mm, 44*mm, 47*mm, 40*mm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,0), 0.3, HAIRLINE),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
    ]))
    parts.append(meta)
    return parts


# ============================================================================
# Section helpers
# ============================================================================
def _section(num: str, title: str, styles):
    """Renders a numbered section heading like '1. Investigation Summary'."""
    p = Paragraph(f"<b>{num}.</b> &nbsp; {title}", styles["h2"])
    rule = Table([[""]], colWidths=[175*mm])
    rule.setStyle(TableStyle([
        ("LINEABOVE", (0,0), (-1,-1), 0.6, INK),
        ("TOPPADDING", (0,0), (-1,-1), 0),
        ("BOTTOMPADDING", (0,0), (-1,-1), 0),
    ]))
    return [p, rule, Spacer(1, 3*mm)]


def _paragraphs(text: Optional[str], styles, style_key="body") -> List[Any]:
    out = []
    text = (text or "").strip()
    if not text:
        out.append(Paragraph("—", styles[style_key]))
        return out
    for para in text.split("\n\n"):
        para = para.strip()
        if para:
            out.append(Paragraph(para, styles[style_key]))
    return out


def _kv_table(rows: List[List[str]], styles, col_widths=(55*mm, 120*mm)):
    body = []
    for k, v in rows:
        body.append([Paragraph(k, styles["kv_label"]), Paragraph(_safe(v), styles["kv_value"])])
    if not body:
        return Spacer(1, 2*mm)
    t = Table(body, colWidths=list(col_widths))
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LINEBELOW", (0,0), (-1,-1), 0.25, HAIRLINE),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING", (0,0), (-1,-1), 0),
    ]))
    return t


def _kpi_grid(items: List[List[str]], styles, cols: int = 4):
    cells, row = [], []
    for lbl, val in items:
        cell = Table([
            [Paragraph(_safe(val), styles["kpi_v"])],
            [Paragraph(lbl, styles["kpi_l"])],
        ])
        cell.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), SOFT_BG),
            ("BOX", (0,0), (-1,-1), 0.3, HAIRLINE),
            ("TOPPADDING", (0,0), (-1,-1), 5),
            ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ]))
        row.append(cell)
        if len(row) == cols:
            cells.append(row); row = []
    if row:
        while len(row) < cols: row.append("")
        cells.append(row)
    w = 175.0 / cols
    t = Table(cells, colWidths=[w*mm]*cols)
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0,0), (-1,-1), 2),
        ("RIGHTPADDING", (0,0), (-1,-1), 2),
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
    ]))
    return t


# ============================================================================
# Findings rendering (the heart of the report)
# ============================================================================
def _finding_block(num: str, finding: Dict[str, Any], txns_by_id: Dict[int, Dict[str, Any]], styles):
    """One full forensic finding."""
    flow = []
    sev = (finding.get("severity") or "Moderate").strip()
    sev_col = _sev_color(sev)

    # Title row with severity badge
    title_text = finding.get("title") or "Untitled finding"
    title_row = Table([
        [Paragraph(f"<b>{num}.</b> &nbsp; {title_text}", styles["finding_title"]),
         Paragraph(f'<font color="{sev_col.hexval()}"><b>{sev.upper()}</b></font>',
                   ParagraphStyle("sevbadge", fontName=_FONT_B, fontSize=9, alignment=2))],
    ], colWidths=[150*mm, 25*mm])
    title_row.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING", (0,0), (-1,-1), 0),
    ]))
    flow.append(title_row)
    flow.append(Spacer(1, 1*mm))

    # Sub-fields
    sub = [
        ("Observation", finding.get("observation")),
        ("Pattern Match", finding.get("pattern_match")),
        ("Behavioral Anomaly", finding.get("behavioral_anomaly")),
        ("Investigative Lead", finding.get("investigative_lead")),
    ]
    sub_rows = []
    for label, text in sub:
        if not text: continue
        sub_rows.append([
            Paragraph(label.upper(), styles["kv_label"]),
            Paragraph(str(text), styles["body"]),
        ])
    if sub_rows:
        sub_table = Table(sub_rows, colWidths=[38*mm, 137*mm])
        sub_table.setStyle(TableStyle([
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("TOPPADDING", (0,0), (-1,-1), 4),
            ("BOTTOMPADDING", (0,0), (-1,-1), 4),
            ("LEFTPADDING", (0,0), (-1,-1), 0),
            ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ]))
        flow.append(sub_table)

    # Evidence table (real txns by id)
    evidence_ids = finding.get("evidence_txn_ids") or []
    if evidence_ids:
        body = [["#", "Date / Time", "Dir", "Counterparty", "Channel", "Amount"]]
        for tid in evidence_ids:
            t = txns_by_id.get(int(tid)) if isinstance(tid, (int,str)) and str(tid).isdigit() else None
            if not t:
                continue
            body.append([
                str(tid),
                str(t.get("timestamp") or "")[:16].replace("T", " "),
                t.get("direction") or t.get("_dir") or "—",
                str(t.get("counterparty") or "")[-15:],
                _safe(t.get("channel")),
                f"{float(t.get('amount') or 0):,.2f}",
            ])
        if len(body) > 1:
            et = Table(body, colWidths=[10*mm, 28*mm, 11*mm, 35*mm, 25*mm, 30*mm], repeatRows=1)
            et.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), SOFT_BG),
                ("FONT", (0,0), (-1,0), _FONT_B, 8),
                ("FONT", (0,1), (-1,-1), _FONT, 8),
                ("LINEABOVE", (0,0), (-1,0), 0.3, INK),
                ("LINEBELOW", (0,0), (-1,0), 0.3, INK),
                ("LINEBELOW", (0,-1), (-1,-1), 0.3, INK),
                ("LINEBELOW", (0,1), (-1,-2), 0.15, HAIRLINE),
                ("ALIGN", (-1,0), (-1,-1), "RIGHT"),
                ("ALIGN", (0,0), (0,-1), "RIGHT"),
                ("TOPPADDING", (0,0), (-1,-1), 3),
                ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ]))
            # color IN green, OUT amber
            for i in range(1, len(body)):
                d = body[i][2]
                if d == "IN":
                    et.setStyle(TableStyle([("TEXTCOLOR",(2,i),(2,i),LOW)]))
                elif d == "OUT":
                    et.setStyle(TableStyle([("TEXTCOLOR",(2,i),(2,i),HIGH)]))
            flow.append(Spacer(1, 1.5*mm))
            flow.append(Paragraph("EVIDENCE", styles["kv_label"]))
            flow.append(Spacer(1, 1*mm))
            flow.append(et)

    flow.append(Spacer(1, 5*mm))
    return KeepTogether(flow)


def _counterparty_table(rows: List[Dict[str, Any]], styles):
    if not rows:
        return Paragraph("No counterparties identified.", styles["body"])
    body = [["Account", "Holder", "Branch", "Txns", "Total", "Direction"]]
    for r in rows:
        body.append([
            _safe(r.get("account_id"))[-15:],
            _safe(r.get("holder_name")),
            _safe(r.get("branch_name")),
            str(r.get("txn_count") or 0),
            f"{float(r.get('total_amount') or 0):,.2f}",
            _safe(r.get("direction_mix")),
        ])
    t = Table(body, colWidths=[34*mm, 40*mm, 42*mm, 13*mm, 26*mm, 20*mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0,0), (-1,0), _FONT_B, 8.5),
        ("FONT", (0,1), (-1,-1), _FONT, 8.5),
        ("LINEABOVE", (0,0), (-1,0), 0.4, INK),
        ("LINEBELOW", (0,0), (-1,0), 0.4, INK),
        ("LINEBELOW", (0,1), (-1,-1), 0.15, HAIRLINE),
        ("LINEBELOW", (0,-1), (-1,-1), 0.4, INK),
        ("ALIGN", (-2,0), (-2,-1), "RIGHT"),
        ("ALIGN", (-3,0), (-3,-1), "RIGHT"),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    return t


def _ledger_table(txns: List[Dict[str, Any]], styles, account_id: str):
    if not txns:
        return Paragraph("No transactions found.", styles["body"])
    rows_sorted = sorted(txns, key=lambda t: str(t.get("timestamp") or ""))
    balance = 0.0
    body = [["#", "Date / Time", "Dir", "Counterparty", "Channel", "Type", "Amount", "Balance"]]
    for i, t in enumerate(rows_sorted, 1):
        d = (t.get("direction") or t.get("_dir") or "").upper()
        amt = float(t.get("amount") or 0)
        if d == "IN": balance += amt
        elif d == "OUT": balance -= amt
        cp = t.get("counterparty") or (t.get("to_account_id") if d == "OUT" else t.get("from_account_id")) or "—"
        body.append([
            str(i),
            str(t.get("timestamp") or "")[:19].replace("T", " "),
            d or "—",
            str(cp)[-15:],
            _safe(t.get("channel")),
            _safe(t.get("transaction_type")),
            f"{amt:,.2f}",
            f"{balance:,.2f}",
        ])
    t = Table(body,
              colWidths=[8*mm, 30*mm, 10*mm, 28*mm, 20*mm, 22*mm, 28*mm, 29*mm],
              repeatRows=1)
    t.setStyle(TableStyle([
        ("FONT", (0,0), (-1,0), _FONT_B, 8),
        ("FONT", (0,1), (-1,-1), _FONT, 7.8),
        ("LINEABOVE", (0,0), (-1,0), 0.4, INK),
        ("LINEBELOW", (0,0), (-1,0), 0.4, INK),
        ("LINEBELOW", (0,1), (-1,-1), 0.15, HAIRLINE),
        ("LINEBELOW", (0,-1), (-1,-1), 0.4, INK),
        ("ALIGN", (0,0), (0,-1), "RIGHT"),
        ("ALIGN", (-2,0), (-1,-1), "RIGHT"),
        ("TOPPADDING", (0,0), (-1,-1), 2.5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2.5),
    ]))
    for i in range(1, len(body)):
        d = body[i][2]
        if d == "IN":
            t.setStyle(TableStyle([("TEXTCOLOR",(2,i),(2,i),LOW)]))
        elif d == "OUT":
            t.setStyle(TableStyle([("TEXTCOLOR",(2,i),(2,i),HIGH)]))
    return t


# ============================================================================
# Doc template with page numbers
# ============================================================================
class _ForensicDoc(BaseDocTemplate):
    def __init__(self, *a, **kw):
        BaseDocTemplate.__init__(self, *a, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                      id="main", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="default", frames=[frame], onPage=self._draw_footer)])

    def _draw_footer(self, canvas, doc):
        canvas.saveState()
        canvas.setFont(_FONT, 7.5)
        canvas.setFillColor(ASH)
        canvas.drawRightString(A4[0] - 18*mm, 10*mm, f"Page {doc.page}")
        canvas.drawString(18*mm, 10*mm, "FlowNet AI · Suspicious Activity Investigation · Confidential")
        canvas.restoreState()


# ============================================================================
# Public builder
# ============================================================================
def build_str_pdf(report: Dict[str, Any]) -> bytes:
    """
    report must include:
      report_id, kind, severity (top-level overall),
      subject{...}, reporting_entity{...},
      narratives{summary, methodology, financial_analysis, counterparty_analysis,
                 risk_determination},
      findings: [{title, observation, pattern_match, behavioral_anomaly,
                  severity, investigative_lead, evidence_txn_ids: [int...]}],
      recommended_actions: [str, ...],
      transaction_kpis: [(label, value), ...],
      counterparties: [...],
      transactions: [...] (each with index assigned matching evidence_txn_ids),
      model_output: {bilstm_softmax | tgn_flagged | cycle_hops}
    """
    styles = _styles()
    buf = BytesIO()
    doc = _ForensicDoc(buf, pagesize=A4,
                       leftMargin=18*mm, rightMargin=18*mm,
                       topMargin=14*mm, bottomMargin=18*mm,
                       title=f"FlowNet · Investigation · {report.get('report_id')}",
                       author="FlowNet AI")
    story: List[Any] = []

    # ===== Cover =====
    story.append(_classification_bar(styles))
    story.append(Spacer(1, 6*mm))
    story.extend(_cover_block(report, styles))
    story.append(Spacer(1, 4*mm))

    # ===== 1. Investigation Summary =====
    story.extend(_section("1", "Investigation Summary", styles))
    story.extend(_paragraphs(report.get("narratives", {}).get("summary"), styles))

    # ===== 2. Subject Profile =====
    su = report.get("subject", {})
    story.extend(_section("2", "Subject Profile", styles))
    story.append(_kv_table([
        ["Account holder", su.get("holder_name")],
        ["Account ID", su.get("account_id")],
        ["Date of birth", su.get("dob")],
        ["Government identifiers", su.get("gov_id") or "Not available in source data"],
        ["Occupation / Business type", su.get("occupation")],
        ["Declared income",
         _inr(su.get("declared_income")) if su.get("declared_income") else None],
        ["Address", su.get("address")],
        ["Branch", su.get("branch_name")],
        ["City / Region", su.get("city_region")],
        ["Account type", su.get("account_type")],
        ["Account opened", su.get("opening_date")],
        ["Customer since", su.get("customer_since")],
        ["Account status", su.get("status")],
    ], styles))

    # ===== 3. Detection Methodology =====
    story.extend(_section("3", "Detection Methodology", styles))
    story.extend(_paragraphs(report.get("narratives", {}).get("methodology"), styles))

    # ===== 4. Findings =====
    story.extend(_section("4", "Findings", styles))
    txns = report.get("transactions") or []
    txns_by_id = {i+1: t for i, t in enumerate(sorted(txns, key=lambda t: str(t.get("timestamp") or "")))}
    findings = report.get("findings") or []
    if not findings:
        story.extend(_paragraphs("No discrete suspicious patterns were extracted by the analyst pipeline. "
                                 "Refer to Sections 5–7 for aggregate analysis.", styles))
    else:
        for i, f in enumerate(findings, 1):
            story.append(_finding_block(f"4.{i}", f, txns_by_id, styles))

    # ===== 5. Financial Activity Analysis =====
    story.extend(_section("5", "Financial Activity Analysis", styles))
    story.extend(_paragraphs(report.get("narratives", {}).get("financial_analysis"), styles))
    kpis = report.get("transaction_kpis") or []
    if kpis:
        story.append(Spacer(1, 3*mm))
        story.append(_kpi_grid(kpis, styles))

    # ===== 6. Counterparty Network =====
    story.extend(_section("6", "Counterparty Network Analysis", styles))
    cps = report.get("counterparties") or []
    if cps:
        story.append(_counterparty_table(cps, styles))
        story.append(Spacer(1, 3*mm))
    story.extend(_paragraphs(report.get("narratives", {}).get("counterparty_analysis"), styles))

    # ===== 7. Risk Determination =====
    story.extend(_section("7", "Risk Determination", styles))
    story.extend(_paragraphs(report.get("narratives", {}).get("risk_determination"), styles))

    # ===== 8. Recommended Investigative Actions =====
    story.extend(_section("8", "Recommended Investigative Actions", styles))
    actions = report.get("recommended_actions") or []
    if actions:
        for i, a in enumerate(actions, 1):
            story.append(Paragraph(f"<b>{i}.</b> &nbsp; {a}", styles["body"]))
    else:
        story.extend(_paragraphs("—", styles))

    # ===== Exhibit A: Ledger =====
    story.append(PageBreak())
    story.extend(_section("A", "Exhibit · Complete Transaction Ledger", styles))
    story.append(Paragraph(
        f"All {len(txns)} transactions associated with this subject, in chronological order. "
        "Real ledger entries pulled directly from the source database.",
        styles["small"]))
    story.append(Spacer(1, 2*mm))
    story.append(_ledger_table(txns, styles, su.get("account_id", "")))

    # ===== Exhibit B: Model Output =====
    mo = report.get("model_output") or {}
    if mo:
        story.append(PageBreak())
        story.extend(_section("B", "Exhibit · Model Output Detail", styles))
        if "bilstm_softmax" in mo:
            story.append(Paragraph("BiLSTM 6-class softmax distribution", styles["h3"]))
            body = [["Class", "Probability"]]
            for cls, p in mo["bilstm_softmax"]:
                body.append([cls, f"{p*100:.2f}%"])
            t = Table(body, colWidths=[60*mm, 30*mm], repeatRows=1)
            t.setStyle(TableStyle([
                ("FONT", (0,0), (-1,0), _FONT_B, 8.5),
                ("FONT", (0,1), (-1,-1), _FONT, 9),
                ("LINEABOVE", (0,0), (-1,0), 0.4, INK),
                ("LINEBELOW", (0,0), (-1,0), 0.4, INK),
                ("LINEBELOW", (0,1), (-1,-1), 0.15, HAIRLINE),
                ("LINEBELOW", (0,-1), (-1,-1), 0.4, INK),
                ("ALIGN", (-1,0), (-1,-1), "RIGHT"),
                ("TOPPADDING", (0,0), (-1,-1), 4),
                ("BOTTOMPADDING", (0,0), (-1,-1), 4),
            ]))
            story.append(t)
        if "tgn_flagged" in mo:
            story.append(Spacer(1, 4*mm))
            story.append(Paragraph("TGN flagged transactions", styles["h3"]))
            body = [["Counterparty", "Dir", "Amount", "Channel", "Timestamp", "Probability"]]
            for r in mo["tgn_flagged"]:
                body.append([
                    str(r.get("counterparty",""))[-15:], r.get("direction",""),
                    f"{float(r.get('amount') or 0):,.2f}",
                    _safe(r.get("channel")),
                    str(r.get("timestamp",""))[:19].replace("T"," "),
                    f"{float(r.get('layering_prob') or 0)*100:.2f}%",
                ])
            t = Table(body, colWidths=[30*mm, 14*mm, 25*mm, 22*mm, 38*mm, 22*mm], repeatRows=1)
            t.setStyle(TableStyle([
                ("FONT", (0,0), (-1,0), _FONT_B, 8.5),
                ("FONT", (0,1), (-1,-1), _FONT, 8),
                ("LINEABOVE", (0,0), (-1,0), 0.4, INK),
                ("LINEBELOW", (0,0), (-1,0), 0.4, INK),
                ("LINEBELOW", (0,1), (-1,-1), 0.15, HAIRLINE),
                ("LINEBELOW", (0,-1), (-1,-1), 0.4, INK),
            ]))
            story.append(t)
        if "cycle_hops" in mo:
            story.append(Spacer(1, 4*mm))
            story.append(Paragraph("Cycle hops", styles["h3"]))
            body = [["#", "From", "To", "Amount", "Channel", "Timestamp", "% of prior"]]
            for i, h in enumerate(mo["cycle_hops"], 1):
                body.append([
                    str(i), str(h.get("source",""))[-12:], str(h.get("target",""))[-12:],
                    f"{float(h.get('amount') or 0):,.2f}",
                    _safe(h.get("channel")),
                    str(h.get("timestamp",""))[:19].replace("T"," "),
                    f"{float(h.get('pct_of_prior') or 1)*100:.1f}%",
                ])
            t = Table(body, colWidths=[8*mm, 25*mm, 25*mm, 25*mm, 18*mm, 38*mm, 20*mm], repeatRows=1)
            t.setStyle(TableStyle([
                ("FONT", (0,0), (-1,0), _FONT_B, 8.5),
                ("FONT", (0,1), (-1,-1), _FONT, 8),
                ("LINEABOVE", (0,0), (-1,0), 0.4, INK),
                ("LINEBELOW", (0,0), (-1,0), 0.4, INK),
                ("LINEBELOW", (0,1), (-1,-1), 0.15, HAIRLINE),
                ("LINEBELOW", (0,-1), (-1,-1), 0.4, INK),
            ]))
            story.append(t)

    # ===== End =====
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph(
        f"FlowNet AI · Reference {report.get('report_id')} · This document is a demo artifact; "
        "do not file with any actual regulator.",
        styles["footer"]))

    doc.build(story)
    return buf.getvalue()