# backend/app/routers/layering.py
"""
Rapid Layering endpoints — powered by the TGN (2nd deep-learning model).

GET /layering/edges            -> transactions the TGN flags as layering (for the graph)
GET /layering/accounts         -> account-level rollup (source accounts of flagged txns) for Alerts
GET /layering/status           -> whether the model loaded + its trained scope

Honest scope: the TGN was trained on a fixed set of accounts (id_map). Only
transactions whose BOTH endpoints are in that set can be scored. Everything
returned is real model output; unscored transactions are simply omitted.
"""
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.db.neo4j_client import neo4j_client
from app.db.supabase_client import supabase_client
from app.ml.tgn_runner import tgn_runner

router = APIRouter(prefix="/layering", tags=["layering"])

_TS_FORMATS = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
               "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"]


def _parse(ts):
    if ts is None:
        return None
    s = str(ts).replace("Z", "").strip()
    if "+" in s[10:]:
        s = s[:10] + s[10:].split("+")[0]
    for f in _TS_FORMATS:
        try:
            return datetime.strptime(s.strip(), f)
        except ValueError:
            continue
    return None


def _prep(txns):
    """Annotate each txn with hour/is_weekend/t_unix from its timestamp."""
    out = []
    for tx in txns:
        dt = _parse(tx.get("timestamp"))
        hour = dt.hour if dt else 0
        is_weekend = 1 if (dt and dt.weekday() >= 5) else 0
        t_unix = dt.timestamp() if dt else 0.0
        out.append({**tx, "hour": hour, "is_weekend": is_weekend, "t_unix": t_unix})
    return out


def _holder(aid: str) -> Optional[str]:
    try:
        info = supabase_client.get_account(aid)
        if info and info.get("customer"):
            return info["customer"].get("full_name")
    except Exception:
        pass
    return None


class LayerEdge(BaseModel):
    source: str
    target: str
    source_actor: Optional[str] = None
    target_actor: Optional[str] = None
    amount: float
    channel: Optional[str] = None
    timestamp: Optional[str] = None
    layering_prob: float


class LayerEdges(BaseModel):
    edges: List[LayerEdge]
    total: int
    scored_transactions: int
    threshold: float
    trained_accounts: int
    model_loaded: bool
    note: Optional[str] = None


class LayerAccount(BaseModel):
    account_id: str
    actor: Optional[str] = None
    flagged_out: int          # # of outgoing txns flagged as layering
    max_prob: float           # highest layering probability among them
    total_amount: float       # sum of flagged outgoing amounts


class LayerAccounts(BaseModel):
    accounts: List[LayerAccount]
    total: int
    threshold: float
    model_loaded: bool


@router.get("/status")
def status():
    tgn_runner.ensure()
    return {
        "model_loaded": tgn_runner.loaded,
        "error": tgn_runner.error,
        "trained_accounts": len(tgn_runner.id_map),
        "threshold": tgn_runner.threshold,
        "features": tgn_runner.cols,
    }


def _run(limit: int):
    raw = neo4j_client.fetch_transactions_for_tgn(limit=limit)
    prepped = _prep(raw)
    return tgn_runner.score_transactions(prepped)


@router.get("/edges", response_model=LayerEdges)
def layering_edges(limit: int = Query(2000, ge=50, le=5000)):
    if not tgn_runner.ensure():
        return LayerEdges(edges=[], total=0, scored_transactions=0,
                          threshold=tgn_runner.threshold, trained_accounts=len(tgn_runner.id_map),
                          model_loaded=False, note=tgn_runner.error or "TGN not loaded")
    scored = _run(limit)
    flagged = [s for s in scored if s["is_layering"]]
    flagged.sort(key=lambda x: x["layering_prob"], reverse=True)
    edges = []
    holder_cache = {}
    for s in flagged:
        for a in (s["from_account"], s["to_account"]):
            if a not in holder_cache:
                holder_cache[a] = _holder(a)
        edges.append(LayerEdge(
            source=s["from_account"], target=s["to_account"],
            source_actor=holder_cache[s["from_account"]],
            target_actor=holder_cache[s["to_account"]],
            amount=s["amount"], channel=s["channel"], timestamp=s["timestamp"],
            layering_prob=s["layering_prob"],
        ))
    return LayerEdges(
        edges=edges, total=len(edges), scored_transactions=len(scored),
        threshold=tgn_runner.threshold, trained_accounts=len(tgn_runner.id_map),
        model_loaded=True,
        note=None if edges else "No transactions crossed the layering threshold in the scored set.",
    )


@router.get("/accounts", response_model=LayerAccounts)
def layering_accounts(limit: int = Query(2000, ge=50, le=5000)):
    if not tgn_runner.ensure():
        return LayerAccounts(accounts=[], total=0, threshold=tgn_runner.threshold, model_loaded=False)
    scored = _run(limit)
    flagged = [s for s in scored if s["is_layering"]]
    by_src = {}
    for s in flagged:
        src = s["from_account"]
        rec = by_src.setdefault(src, {"flagged_out": 0, "max_prob": 0.0, "total_amount": 0.0})
        rec["flagged_out"] += 1
        rec["max_prob"] = max(rec["max_prob"], s["layering_prob"])
        rec["total_amount"] += s["amount"]
    accounts = []
    for src, rec in by_src.items():
        accounts.append(LayerAccount(
            account_id=src, actor=_holder(src),
            flagged_out=rec["flagged_out"], max_prob=round(rec["max_prob"], 4),
            total_amount=rec["total_amount"],
        ))
    accounts.sort(key=lambda x: x.max_prob, reverse=True)
    return LayerAccounts(accounts=accounts, total=len(accounts),
                         threshold=tgn_runner.threshold, model_loaded=True)

class NodeLayerTxn(BaseModel):
    counterparty: str
    direction: str            # OUT (account sent) or IN (account received)
    amount: float
    channel: Optional[str] = None
    timestamp: Optional[str] = None
    layering_prob: float


class NodeLayering(BaseModel):
    account_id: str
    model_loaded: bool
    in_trained_scope: bool
    threshold: float
    flagged: List[NodeLayerTxn]


@router.get("/node/{account_id}", response_model=NodeLayering)
def node_layering(account_id: str, limit: int = Query(2000, ge=50, le=5000)):
    """TGN-flagged transactions that involve this account (for per-txn highlighting)."""
    if not tgn_runner.ensure():
        return NodeLayering(account_id=account_id, model_loaded=False,
                            in_trained_scope=False, threshold=tgn_runner.threshold, flagged=[])
    in_scope = tgn_runner.knows(account_id)
    scored = _run(limit)
    aid = str(account_id)
    flagged = []
    for sdict in scored:
        if not sdict["is_layering"]:
            continue
        if sdict["from_account"] == aid:
            flagged.append(NodeLayerTxn(
                counterparty=sdict["to_account"], direction="OUT",
                amount=sdict["amount"], channel=sdict["channel"],
                timestamp=sdict["timestamp"], layering_prob=sdict["layering_prob"]))
        elif sdict["to_account"] == aid:
            flagged.append(NodeLayerTxn(
                counterparty=sdict["from_account"], direction="IN",
                amount=sdict["amount"], channel=sdict["channel"],
                timestamp=sdict["timestamp"], layering_prob=sdict["layering_prob"]))
    flagged.sort(key=lambda x: x.layering_prob, reverse=True)
    return NodeLayering(account_id=aid, model_loaded=True, in_trained_scope=in_scope,
                        threshold=tgn_runner.threshold, flagged=flagged)