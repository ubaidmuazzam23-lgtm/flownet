# backend/app/routers/reports.py
"""
FlowNet · Suspicious Activity Investigation PDF endpoints.

POST /reports/account/{id}    BiLSTM-flagged account
POST /reports/layering/{id}   TGN-flagged source account
POST /reports/cycle           Detected circular loop (body)

Each endpoint:
  1. Pulls REAL data (Supabase + Neo4j + live model output)
  2. Builds a comprehensive facts dict
  3. Makes per-section LLM calls (Summary, Methodology, Findings, Financial,
     Counterparty, Risk, Actions) — each with the FULL transaction list
  4. Renders forensic-style PDF via fiu_report.build_str_pdf
"""
from __future__ import annotations
import json
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db.supabase_client import supabase_client
from app.db.neo4j_client import neo4j_client
from app.ml.model_runner import model_runner
from app.ml.tgn_runner import tgn_runner
from app.reports.fiu_report import build_str_pdf
from app.config import settings

router = APIRouter(prefix="/reports", tags=["reports"])

# ============================================================================
# LLM
# ============================================================================
try:
    from openai import OpenAI  # type: ignore
    _oa = OpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else None
except Exception:
    _oa = None


_SYSTEM_FORENSIC = (
    "You are a senior forensic AML analyst writing a SUSPICIOUS ACTIVITY INVESTIGATION "
    "report for a bank's financial crimes unit. You analyze REAL transaction data and "
    "model output and write specific, evidence-based prose.\n\n"
    "STRICT RULES:\n"
    "1. Use ONLY the facts in the JSON provided. Never invent names, amounts, dates, IDs, "
    "addresses, counterparties, or relationships.\n"
    "2. Cite specific transactions by their # when describing patterns "
    "(e.g. 'transactions #7 and #8 form an exact-amount pair').\n"
    "3. Reference concrete numbers (real amounts, real counterparty IDs, real timestamps).\n"
    "4. Compare observed activity against the subject's declared income, occupation, and "
    "account age to identify behavioral anomalies.\n"
    "5. Do not speculate about criminal intent ('this is clearly money laundering'). "
    "Describe the observed pattern.\n"
    "6. When citing detection outputs, name the source ('the BiLSTM model returned…', "
    "'the TGN scored this edge at…', 'the cycle-detection engine identified…').\n"
    "7. Output PLAIN TEXT only — no markdown, no headings, no labels. Separate paragraphs "
    "with blank lines.\n"
)


_PROMPTS_TEXT = {
    "summary": (
        "Write the INVESTIGATION SUMMARY for this case. 2 short paragraphs. "
        "Para 1: what was detected, the subject identification, the headline financial "
        "numbers, and the primary suspicion. "
        "Para 2: why this warrants further investigation — the strongest single piece of "
        "evidence and the recommended escalation tier."
    ),
    "methodology": (
        "Write the DETECTION METHODOLOGY section. 2 paragraphs. "
        "Para 1: technical description of the detector that flagged this (architecture, "
        "input features, decision rule). "
        "Para 2: why this specific case crossed the decision threshold — what the model "
        "or algorithm 'saw' that triggered the alert. Reference the verdict/probability values."
    ),
    "financial_analysis": (
        "Write the FINANCIAL ACTIVITY ANALYSIS section. 2 paragraphs. "
        "Para 1: aggregate flow analysis — total inflow, outflow, net position, transaction "
        "count, velocity, and how this compares to the subject's declared income and occupation "
        "baseline. Cite specific multiples (e.g. '4.2x declared income'). "
        "Para 2: temporal and channel-mix analysis — clustering of activity, channel preferences, "
        "any unusual time-of-day or burst patterns. Reference real numbers and time windows."
    ),
    "counterparty_analysis": (
        "Write the COUNTERPARTY NETWORK ANALYSIS. 2 paragraphs. "
        "Para 1: structure of the counterparty network — unique-counterparty count, "
        "concentration (top counterparty share of total volume), direction mix (one-way "
        "vs bidirectional), and any repeat counterparties. "
        "Para 2: interpretation — what the network shape implies about the activity (e.g. "
        "'narrow counterparty set + high concentration is characteristic of pass-through layering')."
    ),
    "risk_determination": (
        "Write the RISK DETERMINATION. 1-2 paragraphs. "
        "Assign overall severity (CRITICAL / HIGH / MEDIUM / LOW). State the rating in the "
        "first sentence, then justify it with the strongest 3-4 specific evidence points from "
        "the case. Compare to baseline expectation for this customer profile. End with a one-line "
        "explicit recommendation: refer to FIU / enhanced monitoring / additional KYC / clear."
    ),
}


def _call_text(section_key: str, facts: Dict[str, Any], fallback: str) -> str:
    """Single LLM call returning plain text. Falls back on any failure."""
    if _oa is None:
        return fallback
    try:
        resp = _oa.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_FORENSIC + "\n\n" + _PROMPTS_TEXT[section_key]},
                {"role": "user", "content":
                    "ANALYZE this case and write the section. Use only these verified facts:\n\n"
                    + json.dumps(facts, indent=2, default=str)},
            ],
            temperature=0.3,
            max_tokens=900,
        )
        text = (resp.choices[0].message.content or "").strip()
        return text if len(text) >= 80 else fallback
    except Exception as e:
        print(f"[reports] LLM text section '{section_key}' failed: {e}")
        return fallback


_FINDINGS_PROMPT = (
    "You are conducting a forensic investigation. Examine the FULL transaction list below "
    "and identify EVERY distinct suspicious pattern you can find. For each pattern, write a "
    "structured FINDING.\n\n"
    "Look for (non-exhaustive):\n"
    "- Exact-amount pass-throughs (same amount IN then OUT within minutes/hours)\n"
    "- Sub-threshold structuring (e.g. amounts just below 50,000 / 100,000 / 500,000 INR)\n"
    "- Tight time clusters (multiple transactions in unusually short windows)\n"
    "- Round-tripping (funds returning via intermediaries)\n"
    "- Counterparty concentration (single counterparty dominating volume)\n"
    "- Dormant-burst patterns (long quiet, then sudden activity)\n"
    "- Off-hours / weekend activity inconsistent with profile\n"
    "- Channel switching (e.g. shift from BRANCH to MOBILE for high-value txns)\n"
    "- Income-flow mismatch (flow far exceeding declared income)\n"
    "- Counterparty-network shape suggesting layering hubs\n\n"
    "Return findings as STRICT JSON, an array. Each finding is an object with EXACTLY these fields:\n"
    "{\n"
    '  "title": "short specific title (max 12 words, no quotes inside)",\n'
    '  "observation": "3-5 sentences describing what was specifically seen, citing transaction # numbers and real amounts/times/counterparties",\n'
    '  "pattern_match": "1-3 sentences naming the AML pattern and why it matches",\n'
    '  "behavioral_anomaly": "1-3 sentences comparing to declared income, occupation, account age baseline",\n'
    '  "severity": "Critical | High | Moderate | Low",\n'
    '  "investigative_lead": "1-2 sentences on what to pull next to confirm/deny",\n'
    '  "evidence_txn_ids": [list of integer transaction # ids from the data]\n'
    "}\n\n"
    "RULES:\n"
    "- Generate ONE finding per distinct pattern. Aim for 3 to 8 findings.\n"
    "- If a pattern isn't really there in the data, DO NOT INVENT IT.\n"
    "- evidence_txn_ids must reference real # values from the transactions array (# starts at 1).\n"
    "- Use ONLY the facts provided. No invention.\n"
    "- Output a JSON array ONLY. No prose, no markdown, no code fences."
)


def _call_findings(facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Generate structured findings via JSON-mode call. Empty list on failure."""
    if _oa is None:
        return []
    try:
        resp = _oa.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_FORENSIC},
                {"role": "user", "content": _FINDINGS_PROMPT + "\n\nCASE DATA:\n"
                 + json.dumps(facts, indent=2, default=str)},
            ],
            temperature=0.4,
            max_tokens=2500,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        # accept either {"findings":[...]} or a bare array
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            for v in parsed.values():
                if isinstance(v, list):
                    return v
            return []
        if isinstance(parsed, list):
            return parsed
        return []
    except Exception as e:
        print(f"[reports] LLM findings call failed: {e}")
        return []


_ACTIONS_PROMPT = (
    "Based on the case facts and the findings, write 5-8 concrete RECOMMENDED INVESTIGATIVE ACTIONS. "
    "Each must be specific to THIS case, not generic. Tailor to the patterns observed (e.g. if "
    "structuring is suspected, suggest pulling the counterparty's own history). "
    "Return a JSON ARRAY of strings only — no other keys, no markdown. Each string is one action, "
    "starting with a verb (Freeze, Subpoena, Request, Cross-reference, Escalate, etc.)."
)


def _call_actions(facts: Dict[str, Any], findings: List[Dict[str, Any]]) -> List[str]:
    """Generate the bulleted Recommended Actions list."""
    if _oa is None:
        return [
            "Place the account under enhanced monitoring.",
            "Request KYC re-verification and source-of-funds documentation.",
            "Pull historical statements for the prior 12 months.",
            "Cross-reference top counterparties against existing watchlists.",
            "If risk persists, escalate to FIU within the statutory window.",
        ]
    try:
        body = {"case": facts, "findings": findings}
        resp = _oa.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_FORENSIC},
                {"role": "user", "content": _ACTIONS_PROMPT + "\n\nDATA:\n"
                 + json.dumps(body, indent=2, default=str)},
            ],
            temperature=0.3,
            max_tokens=600,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            for v in parsed.values():
                if isinstance(v, list) and all(isinstance(x, str) for x in v):
                    return v
            return []
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
        return []
    except Exception as e:
        print(f"[reports] LLM actions call failed: {e}")
        return [
            "Place the account under enhanced monitoring.",
            "Request KYC re-verification and source-of-funds documentation.",
            "Pull historical statements for the prior 12 months.",
            "Cross-reference top counterparties against existing watchlists.",
            "If risk persists, escalate to FIU within the statutory window.",
        ]


# ============================================================================
# DB / data helpers
# ============================================================================
def _kyc(account_id: str) -> Optional[Dict[str, Any]]:
    rec = supabase_client.get_account(account_id)
    if not rec or not rec.get("account"):
        return None
    a = rec.get("account") or {}
    c = rec.get("customer") or {}
    b = rec.get("branch") or {}
    return {
        "account_id": a.get("account_id"),
        "holder_name": c.get("full_name"),
        "dob": c.get("date_of_birth") or c.get("dob"),
        "occupation": c.get("occupation"),
        "declared_income": c.get("declared_income"),
        "address": c.get("address"),
        "customer_since": c.get("customer_since"),
        "branch_name": b.get("branch_name") or b.get("name"),
        "city_region": " · ".join(str(p) for p in [b.get("city"), b.get("region")] if p) or None,
        "opening_date": a.get("created_date") or a.get("opening_date"),
        "status": a.get("status"),
        "account_type": a.get("account_type"),
        "gov_id": None,
    }


def _normalize_txns(account_id: str, raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for t in raw or []:
        d = t.get("_dir") or t.get("direction")
        if not d:
            if t.get("from_account_id") == account_id: d = "OUT"
            elif t.get("to_account_id") == account_id: d = "IN"
            else: d = ""
        cp = t.get("to_account_id") if d == "OUT" else t.get("from_account_id")
        out.append({**t, "direction": d, "_dir": d, "counterparty": cp})
    out.sort(key=lambda t: str(t.get("timestamp") or ""))
    return out


def _txns_with_ids(txns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Annotate each transaction with a 1-based # for LLM evidence citations."""
    return [{"#": i + 1, **t} for i, t in enumerate(txns)]


def _aggregate(txns: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not txns:
        return {"count": 0, "in_count": 0, "out_count": 0, "total_in": 0.0,
                "total_out": 0.0, "net": 0.0, "channel_mix": "", "channel_breakdown": {},
                "date_range": "—", "largest": 0.0, "average": 0.0}
    in_amts = [float(t.get("amount") or 0) for t in txns if t.get("direction") == "IN"]
    out_amts = [float(t.get("amount") or 0) for t in txns if t.get("direction") == "OUT"]
    all_amts = [float(t.get("amount") or 0) for t in txns]
    mix: Dict[str, int] = {}
    for t in txns:
        ch = t.get("channel") or "—"
        mix[ch] = mix.get(ch, 0) + 1
    mix_str = ", ".join(f"{k} ({v})" for k, v in sorted(mix.items(), key=lambda kv: -kv[1]))
    ts = sorted([str(t.get("timestamp"))[:10] for t in txns if t.get("timestamp")])
    return {
        "count": len(txns), "in_count": len(in_amts), "out_count": len(out_amts),
        "total_in": sum(in_amts), "total_out": sum(out_amts),
        "net": sum(in_amts) - sum(out_amts),
        "channel_mix": mix_str, "channel_breakdown": mix,
        "date_range": f"{ts[0]} → {ts[-1]}" if ts else "—",
        "largest": max(all_amts) if all_amts else 0.0,
        "average": (sum(all_amts)/len(all_amts)) if all_amts else 0.0,
    }


def _counterparty_summary(txns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, Any]] = {}
    for t in txns:
        cp = t.get("counterparty")
        if not cp: continue
        b = buckets.setdefault(cp, {"account_id": cp, "txn_count": 0, "total_amount": 0.0,
                                    "in_count": 0, "out_count": 0})
        b["txn_count"] += 1
        b["total_amount"] += float(t.get("amount") or 0)
        if t.get("direction") == "IN": b["in_count"] += 1
        elif t.get("direction") == "OUT": b["out_count"] += 1
    rows = sorted(buckets.values(), key=lambda r: -r["total_amount"])[:10]
    for r in rows:
        k = _kyc(r["account_id"]) or {}
        r["holder_name"] = k.get("holder_name")
        r["branch_name"] = k.get("branch_name")
        r["direction_mix"] = ("Both" if r["in_count"] and r["out_count"]
                              else "IN only" if r["in_count"]
                              else "OUT only" if r["out_count"] else "—")
    return rows


def _reporting_entity(branch_name: Optional[str] = None) -> Dict[str, str]:
    return {
        "name": "FlowNet AI · Demo Compliance Console",
        "category": "Demo / R&D Platform",
        "branch": branch_name or "—",
        "principal_officer": "Investigator (demo)",
        "contact": "demo@flownet.ai",
    }


def _ref(prefix: str, suffix: str) -> str:
    return f"FN-INV-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{prefix}-{suffix[-6:]}"


def _pdf_response(pdf: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf)),
        },
    )


def _infer_severity(findings: List[Dict[str, Any]]) -> str:
    """Worst-case severity from the findings list, for the cover badge."""
    levels = {"low": 1, "moderate": 2, "medium": 2, "high": 3, "critical": 4}
    best = 1
    for f in findings:
        s = (f.get("severity") or "").strip().lower()
        best = max(best, levels.get(s, 1))
    return {1: "Low", 2: "Moderate", 3: "High", 4: "Critical"}[best]


# ============================================================================
# 1) BiLSTM account
# ============================================================================
@router.post("/account/{account_id}")
def report_for_account(account_id: str):
    kyc = _kyc(account_id)
    if not kyc:
        raise HTTPException(404, f"Account {account_id} not found.")
    raw_txns = supabase_client.get_account_transactions(account_id, limit=100000)
    if not raw_txns:
        raise HTTPException(400, "No transactions on file.")
    txns = _normalize_txns(account_id, raw_txns)
    txns_indexed = _txns_with_ids(txns)
    agg = _aggregate(txns)
    cps = _counterparty_summary(txns)
    income = float(kyc.get("declared_income") or 0.0)

    verdict = model_runner.predict_account(account_id, declared_income=income)
    fraud_type = verdict.get("fraud_type") or "Normal"
    confidence = float(verdict.get("confidence") or 0.0)
    if fraud_type == "Normal":
        raise HTTPException(400, "BiLSTM did not flag this account as suspicious.")

    facts = {
        "detection_source": "FlowNet BiLSTM account-level fraud classifier",
        "model": {
            "architecture": "Bidirectional LSTM, 6-class softmax",
            "sequence_length": 30,
            "features": ["amount", "time_gap_to_prev", "channel_code", "transaction_type_code"],
            "classes": ["Normal", "Structuring", "Dormant", "Velocity Spike",
                        "Sleeping Beauty", "Micro+Drain"],
            "verdict": fraud_type,
            "confidence_pct": round(confidence * 100, 2),
        },
        "subject": kyc,
        "aggregate": agg,
        "flow_vs_income_ratio": (agg["total_in"] / income) if income else None,
        "top_counterparties": [
            {"account_id": r["account_id"], "holder": r.get("holder_name"),
             "txn_count": r["txn_count"], "total_amount_inr": round(r["total_amount"], 2),
             "direction_mix": r["direction_mix"]} for r in cps
        ],
        "transactions": txns_indexed,
    }

    findings = _call_findings(facts)
    actions = _call_actions(facts, findings)
    severity = _infer_severity(findings) if findings else "High"

    fallback_summary = (
        f"Account {account_id} ({kyc.get('holder_name')}) was flagged by the FlowNet BiLSTM as "
        f"'{fraud_type}' at {confidence*100:.1f}% confidence over a 30-transaction sequence. "
        f"Total observed flow {agg['total_in']+agg['total_out']:,.2f} INR across {agg['count']} "
        f"transactions ({agg['date_range']})."
    )
    narratives = {
        "summary": _call_text("summary", facts, fallback_summary),
        "methodology": _call_text("methodology", facts,
            "The BiLSTM model ingests a 30-transaction sequence per account and outputs a 6-class softmax."),
        "financial_analysis": _call_text("financial_analysis", facts,
            f"Channel mix: {agg['channel_mix']}. Total inflow {agg['total_in']:,.2f} INR vs declared "
            f"income {income:,.2f} INR."),
        "counterparty_analysis": _call_text("counterparty_analysis", facts,
            f"{len(cps)} unique counterparties identified."),
        "risk_determination": _call_text("risk_determination", facts,
            f"{severity.upper()} — model confidence {confidence*100:.1f}% with flow/income ratio "
            f"{(agg['total_in']/income):.1f}x." if income else f"{severity.upper()}."),
    }

    transaction_kpis = [
        ("Transactions", str(agg["count"])),
        ("Inflow count", str(agg["in_count"])),
        ("Outflow count", str(agg["out_count"])),
        ("Net flow (INR)", f"{agg['net']:,.0f}"),
        ("Total inflow (INR)", f"{agg['total_in']:,.0f}"),
        ("Total outflow (INR)", f"{agg['total_out']:,.0f}"),
        ("Largest single txn", f"{agg['largest']:,.0f}"),
        ("Average txn", f"{agg['average']:,.0f}"),
        ("Date range", agg["date_range"]),
        ("Declared income", f"{income:,.0f}" if income else "—"),
        ("Flow / income ratio", f"{(agg['total_in']/income):.1f}x" if income else "—"),
        ("Channel mix", agg["channel_mix"]),
    ]

    model_output = {}
    probs = verdict.get("probabilities")
    if probs and isinstance(probs, dict):
        labels = settings.LABELS if hasattr(settings, "LABELS") else list(probs.keys())
        model_output["bilstm_softmax"] = [(c, float(probs.get(c) or 0.0)) for c in labels]
    elif probs and isinstance(probs, (list, tuple)):
        labels = settings.LABELS if hasattr(settings, "LABELS") else [f"Class {i}" for i in range(len(probs))]
        model_output["bilstm_softmax"] = list(zip(labels, [float(p) for p in probs]))

    report = {
        "report_id": _ref("BILSTM", account_id),
        "kind": f"BiLSTM Account · {fraud_type}",
        "severity": severity,
        "reporting_entity": _reporting_entity(kyc.get("branch_name")),
        "subject": kyc,
        "narratives": narratives,
        "findings": findings,
        "recommended_actions": actions,
        "transaction_kpis": transaction_kpis,
        "counterparties": cps,
        "transactions": txns,
        "model_output": model_output,
    }
    return _pdf_response(build_str_pdf(report), f"FlowNet-Investigation-Account-{account_id}.pdf")


# ============================================================================
# 2) TGN Layering
# ============================================================================
@router.post("/layering/{account_id}")
def report_for_layering(account_id: str):
    if not tgn_runner.ensure():
        raise HTTPException(503, "TGN model is not loaded.")
    kyc = _kyc(account_id)
    if not kyc:
        raise HTTPException(404, f"Account {account_id} not found.")
    aid = str(account_id)

    raw_pool = neo4j_client.fetch_transactions_for_tgn(limit=100000)
    scored = tgn_runner.score_transactions(raw_pool)
    threshold = float(tgn_runner.threshold or 0.5)
    flagged_raw = [s for s in scored if s.get("is_layering")
                   and (s["from_account"] == aid or s["to_account"] == aid)]
    if not flagged_raw:
        raise HTTPException(400, "TGN did not flag any transactions involving this account.")

    flagged_view = []
    for s in flagged_raw:
        d = "OUT" if s["from_account"] == aid else "IN"
        cp = s["to_account"] if d == "OUT" else s["from_account"]
        flagged_view.append({
            "timestamp": s.get("timestamp"), "direction": d, "_dir": d,
            "counterparty": cp,
            "from_account_id": s["from_account"], "to_account_id": s["to_account"],
            "channel": s.get("channel"), "transaction_type": s.get("transaction_type"),
            "amount": s["amount"], "layering_prob": s["layering_prob"],
        })

    all_txns = _normalize_txns(account_id, supabase_client.get_account_transactions(account_id, limit=100000))
    txns_indexed = _txns_with_ids(all_txns)
    agg = _aggregate(all_txns)
    cps = _counterparty_summary(all_txns)
    income = float(kyc.get("declared_income") or 0.0)
    total_flagged = sum(float(s["amount"]) for s in flagged_raw)
    max_prob = max(float(s["layering_prob"]) for s in flagged_raw)

    facts = {
        "detection_source": "FlowNet Temporal Graph Network (TGN) layering model",
        "model": {
            "architecture": "TGN with GRU-based memory + per-edge MLP classifier",
            "trained_scope_accounts": 80,
            "features": ["log_amount", "hour", "is_weekend", "is_fast_channel", "is_api_channel"],
            "threshold_pct": round(threshold * 100, 2),
            "max_probability_pct": round(max_prob * 100, 2),
            "flagged_transaction_count": len(flagged_raw),
            "total_value_flagged_inr": round(total_flagged, 2),
        },
        "subject": kyc,
        "aggregate": agg,
        "flow_vs_income_ratio": (agg["total_in"] / income) if income else None,
        "flagged_transactions": flagged_view,
        "top_counterparties": [
            {"account_id": r["account_id"], "holder": r.get("holder_name"),
             "txn_count": r["txn_count"], "total_amount_inr": round(r["total_amount"], 2),
             "direction_mix": r["direction_mix"]} for r in cps
        ],
        "transactions": txns_indexed,
    }

    findings = _call_findings(facts)
    actions = _call_actions(facts, findings)
    severity = _infer_severity(findings) if findings else "High"

    narratives = {
        "summary": _call_text("summary", facts,
            f"TGN flagged {len(flagged_raw)} transactions involving {account_id} ({kyc.get('holder_name')}) "
            f"as layering, max prob {max_prob*100:.1f}% vs threshold {threshold*100:.1f}%."),
        "methodology": _call_text("methodology", facts,
            "The TGN scores each transaction edge using its evolving memory and 5 engineered features."),
        "financial_analysis": _call_text("financial_analysis", facts,
            f"Total flagged value {total_flagged:,.2f} INR across {len(flagged_raw)} transactions."),
        "counterparty_analysis": _call_text("counterparty_analysis", facts,
            f"{len(cps)} unique counterparties identified."),
        "risk_determination": _call_text("risk_determination", facts, f"{severity.upper()}."),
    }

    transaction_kpis = [
        ("Flagged txns", str(len(flagged_raw))),
        ("Top probability", f"{max_prob*100:.1f}%"),
        ("Threshold", f"{threshold*100:.1f}%"),
        ("Flagged value", f"{total_flagged:,.0f}"),
        ("Total txns", str(agg["count"])),
        ("Total inflow", f"{agg['total_in']:,.0f}"),
        ("Total outflow", f"{agg['total_out']:,.0f}"),
        ("Date range", agg["date_range"]),
        ("Declared income", f"{income:,.0f}" if income else "—"),
        ("Flow / income", f"{(agg['total_in']/income):.1f}x" if income else "—"),
        ("Trained scope", "80 accounts"),
        ("Channel mix", agg["channel_mix"]),
    ]

    report = {
        "report_id": _ref("TGN", account_id),
        "kind": "TGN · Rapid Layering",
        "severity": severity,
        "reporting_entity": _reporting_entity(kyc.get("branch_name")),
        "subject": kyc,
        "narratives": narratives,
        "findings": findings,
        "recommended_actions": actions,
        "transaction_kpis": transaction_kpis,
        "counterparties": cps,
        "transactions": all_txns,
        "model_output": {"tgn_flagged": flagged_view},
    }
    return _pdf_response(build_str_pdf(report), f"FlowNet-Investigation-Layering-{account_id}.pdf")


# ============================================================================
# 3) Cycle
# ============================================================================
class CycleStepIn(BaseModel):
    account_id: str
    actor: Optional[str] = None


class CycleEdgeIn(BaseModel):
    source: str
    target: str
    amount: float
    channel: Optional[str] = None
    timestamp: Optional[str] = None


class CycleReportIn(BaseModel):
    path: List[CycleStepIn]
    edges: List[CycleEdgeIn]
    amount: float
    hops: int
    similarity: Optional[float] = None
    duration_hours: Optional[float] = None
    fast: Optional[bool] = False


@router.post("/cycle")
def report_for_cycle(payload: CycleReportIn = Body(...)):
    if not payload.path or not payload.edges:
        raise HTTPException(400, "Empty cycle payload.")
    origin = payload.path[0]
    origin_kyc = _kyc(origin.account_id) or {}
    origin_txns = _normalize_txns(origin.account_id,
        supabase_client.get_account_transactions(origin.account_id, limit=100000))
    txns_indexed = _txns_with_ids(origin_txns)
    agg = _aggregate(origin_txns)
    cps = _counterparty_summary(origin_txns)
    income = float(origin_kyc.get("declared_income") or 0.0)

    cycle_hops = []
    prior = None
    for e in payload.edges:
        pct = (e.amount / prior) if prior else 1.0
        cycle_hops.append({
            "source": e.source, "target": e.target, "amount": e.amount,
            "channel": e.channel, "timestamp": e.timestamp, "pct_of_prior": pct,
        })
        prior = e.amount

    chain = " -> ".join((s.actor or f"...{s.account_id[-4:]}") for s in payload.path)
    sim_pct = (payload.similarity or 0) * 100

    intermediaries = []
    for step in payload.path[1:-1] if len(payload.path) >= 3 else payload.path[1:]:
        k = _kyc(step.account_id) or {}
        intermediaries.append({
            "account_id": step.account_id,
            "holder_name": k.get("holder_name") or step.actor,
            "branch_name": k.get("branch_name"),
            "txn_count": 1, "total_amount": payload.amount, "direction_mix": "Via",
        })

    facts = {
        "detection_source": "FlowNet cycle-detection engine (graph algorithm, not ML)",
        "method": "Flow-continuity scan with similarity band 80-125% and time window 72h",
        "subject": origin_kyc,
        "cycle": {
            "origin_account_id": origin.account_id,
            "origin_holder": origin_kyc.get("holder_name") or origin.actor,
            "amount_through_loop_inr": payload.amount,
            "hops": payload.hops,
            "amount_similarity_pct": round(sim_pct, 2),
            "duration_hours": payload.duration_hours,
            "fast_flag": bool(payload.fast),
            "path_chain": chain,
            "intermediaries": [i["holder_name"] for i in intermediaries],
            "edges_in_loop": [
                {"from": e.source, "to": e.target, "amount_inr": e.amount,
                 "channel": e.channel, "timestamp": e.timestamp} for e in payload.edges
            ],
        },
        "aggregate": agg,
        "flow_vs_income_ratio": (agg["total_in"] / income) if income else None,
        "top_counterparties": [
            {"account_id": r["account_id"], "holder": r.get("holder_name"),
             "txn_count": r["txn_count"], "total_amount_inr": round(r["total_amount"], 2)}
            for r in cps
        ],
        "transactions": txns_indexed,
    }

    findings = _call_findings(facts)
    actions = _call_actions(facts, findings)
    severity = _infer_severity(findings) if findings else "Critical"

    narratives = {
        "summary": _call_text("summary", facts,
            f"A {payload.hops}-hop circular flow of {payload.amount:,.2f} INR was detected "
            f"originating from {origin.account_id}."),
        "methodology": _call_text("methodology", facts,
            "Cycle-detection performs a depth-bounded graph walk over the transaction network."),
        "financial_analysis": _call_text("financial_analysis", facts,
            f"Loop amount {payload.amount:,.2f} INR; origin total in {agg['total_in']:,.2f} INR."),
        "counterparty_analysis": _call_text("counterparty_analysis", facts,
            f"{len(intermediaries)} intermediary accounts participated in the loop."),
        "risk_determination": _call_text("risk_determination", facts,
            f"{severity.upper()} — circular flow with {sim_pct:.0f}% similarity."),
    }

    transaction_kpis = [
        ("Loop hops", str(payload.hops)),
        ("Loop amount", f"{payload.amount:,.0f}"),
        ("Amount similarity", f"{sim_pct:.1f}%"),
        ("Duration", f"{payload.duration_hours:.2f}h" if payload.duration_hours is not None else "—"),
        ("Fast loop", "Yes" if payload.fast else "No"),
        ("Origin txns", str(agg["count"])),
        ("Origin inflow", f"{agg['total_in']:,.0f}"),
        ("Origin outflow", f"{agg['total_out']:,.0f}"),
        ("Date range", agg["date_range"]),
        ("Declared income", f"{income:,.0f}" if income else "—"),
        ("Intermediaries", str(len(intermediaries))),
        ("Detection", "Graph algorithm"),
    ]

    report = {
        "report_id": _ref("CYCLE", origin.account_id),
        "kind": "Circular AML Loop",
        "severity": severity,
        "reporting_entity": _reporting_entity(origin_kyc.get("branch_name")),
        "subject": origin_kyc,
        "narratives": narratives,
        "findings": findings,
        "recommended_actions": actions,
        "transaction_kpis": transaction_kpis,
        "counterparties": intermediaries + cps[:5],
        "transactions": origin_txns,
        "model_output": {"cycle_hops": cycle_hops},
    }
    return _pdf_response(build_str_pdf(report), f"FlowNet-Investigation-Cycle-{origin.account_id}.pdf")