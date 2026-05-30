# backend/app/routers/accounts.py
"""
Accounts endpoints — browse any account (read-only).

GET /accounts            -> list accounts (id, type, status, branch, holder)
GET /accounts/{id}       -> full account detail + transaction history
"""
from fastapi import APIRouter, Query, HTTPException

from app.db.supabase_client import supabase_client
from app.schemas.account import AccountSummary, AccountList, AccountDetail

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=AccountList)
def list_accounts(limit: int = Query(100, ge=1, le=500)):
    try:
        rows = supabase_client.list_accounts(limit=limit)
    except Exception:
        raise HTTPException(503, "Account service temporarily unavailable — please retry")
    items = [AccountSummary(**r) for r in rows]
    return AccountList(items=items, total=len(items))


@router.get("/{account_id}", response_model=AccountDetail)
def account_detail(account_id: str):
    try:
        info = supabase_client.get_account(account_id)
    except Exception:
        raise HTTPException(503, "Account service temporarily unavailable — please retry")
    if not info:
        raise HTTPException(404, f"Account {account_id} not found")

    acc = info.get("account") or {}
    cust = info.get("customer") or {}
    br = info.get("branch") or {}

    try:
        txns = supabase_client.get_account_transactions(account_id, limit=100000)
    except Exception:
        txns = []

    total_in = sum(float(t.get("amount") or 0) for t in txns if t.get("_dir") == "IN")
    total_out = sum(float(t.get("amount") or 0) for t in txns if t.get("_dir") == "OUT")

    tx_out = [{
        "amount": float(t.get("amount") or 0),
        "channel": t.get("channel"),
        "timestamp": str(t.get("timestamp")),
        "direction": t.get("_dir"),
        "counterparty": str(t.get("to_account_id") if t.get("_dir") == "OUT" else t.get("from_account_id")),
    } for t in txns]

    return AccountDetail(
        account_id=str(acc.get("account_id", account_id)),
        account_type=acc.get("account_type"),
        status=acc.get("status"),
        created_date=str(acc.get("created_date")) if acc.get("created_date") else None,
        actor=cust.get("full_name"),
        occupation=cust.get("occupation"),
        declared_income=float(cust["declared_income"]) if cust.get("declared_income") is not None else None,
        customer_since=str(cust.get("customer_since")) if cust.get("customer_since") else None,
        branch=br.get("branch_name"),
        city=br.get("city"),
        region=br.get("region"),
        transactions=tx_out,
        total_in=total_in,
        total_out=total_out,
    )