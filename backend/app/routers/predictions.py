# backend/app/routers/predictions.py
"""
Predictions / alerts endpoints.

GET /predictions               -> runs BiLSTM across accounts, non-Normal verdicts
   ?include_normal=true / ?limit=N
GET /predictions/{id}          -> runs model on one account, full verdict
GET /predictions/{id}/detail   -> verdict + the real 30 transactions the model saw

Detection comes ONLY from the shared model. No rules, no thresholds.
"""
import time
from typing import Optional, Dict, Tuple
from fastapi import APIRouter, Query, HTTPException

from app.db.neo4j_client import neo4j_client
from app.db.supabase_client import supabase_client
from app.ml.model_runner import model_runner
from app.schemas.prediction import (
    Prediction, PredictionList, PredictionDetail, TxnRow,
)

router = APIRouter(prefix="/predictions", tags=["predictions"])

_cache: Dict[str, Tuple[dict, float]] = {}
_CACHE_TTL = 120


def _account_info(account_id: str):
    """Single Supabase lookup. Returns full dict; tolerates transient failure."""
    try:
        info = supabase_client.get_account(account_id)
    except Exception:
        return None
    return info


def _income_actor_branch(info):
    cust = (info or {}).get("customer") or {}
    br = (info or {}).get("branch") or {}
    income = float(cust.get("declared_income") or 0.0)
    return income, cust.get("full_name"), br.get("branch_name")


def _run_for_account(account_id: str, income: float) -> Optional[dict]:
    now = time.time()
    cached = _cache.get(account_id)
    if cached and cached[1] > now:
        return cached[0]
    verdict = model_runner.predict_account(account_id, declared_income=income)
    if verdict is not None:
        _cache[account_id] = (verdict, now + _CACHE_TTL)
    return verdict


@router.get("", response_model=PredictionList)
def list_predictions(
    include_normal: bool = Query(False),
    limit: int = Query(60, ge=1, le=500),
):
    account_ids = neo4j_client.list_account_ids(limit=limit)
    items = []
    for aid in account_ids:
        info = _account_info(aid)
        income, actor, branch = _income_actor_branch(info)
        verdict = _run_for_account(aid, income)
        if verdict is None:
            continue
        if not include_normal and verdict["fraud_type"] == "Normal":
            continue
        items.append(Prediction(**verdict, actor=actor, branch=branch))
    items.sort(key=lambda p: p.confidence, reverse=True)
    return PredictionList(items=items, total=len(items))


@router.get("/{account_id}", response_model=Prediction)
def predict_one(account_id: str):
    info = _account_info(account_id)
    income, actor, branch = _income_actor_branch(info)
    verdict = _run_for_account(account_id, income)
    if verdict is None:
        raise HTTPException(404, f"No transactions found for account {account_id}")
    return Prediction(**verdict, actor=actor, branch=branch)


@router.get("/{account_id}/detail", response_model=PredictionDetail)
def predict_detail(account_id: str):
    info = _account_info(account_id)
    income, actor, branch = _income_actor_branch(info)
    verdict = _run_for_account(account_id, income)
    if verdict is None:
        raise HTTPException(404, f"No transactions found for account {account_id}")

    txns_raw = neo4j_client.fetch_last_transactions(account_id)
    transactions = [
        TxnRow(
            amount=float(t.get("amount") or 0.0),
            channel=t.get("channel"),
            timestamp=str(t.get("timestamp")),
            direction=t.get("direction"),
            counterparty=t.get("counterparty"),
        )
        for t in txns_raw
    ]

    cust = (info or {}).get("customer") or {}
    acc = (info or {}).get("account") or {}

    return PredictionDetail(
        prediction=Prediction(**verdict, actor=actor, branch=branch),
        transactions=transactions,
        occupation=cust.get("occupation"),
        declared_income=float(cust["declared_income"]) if cust.get("declared_income") is not None else None,
        customer_since=str(cust.get("customer_since")) if cust.get("customer_since") else None,
        account_status=acc.get("status"),
        account_type=acc.get("account_type"),
    )