# backend/app/schemas/account.py
"""Pydantic shapes for the Accounts screen. Frontend types mirror these."""
from typing import Optional, List
from pydantic import BaseModel


class AccountSummary(BaseModel):
    account_id: str
    account_type: Optional[str] = None
    status: Optional[str] = None
    branch: Optional[str] = None
    actor: Optional[str] = None


class AccountList(BaseModel):
    items: List[AccountSummary]
    total: int


class AccountDetail(BaseModel):
    account_id: str
    account_type: Optional[str] = None
    status: Optional[str] = None
    created_date: Optional[str] = None
    # customer
    actor: Optional[str] = None
    occupation: Optional[str] = None
    declared_income: Optional[float] = None
    customer_since: Optional[str] = None
    # branch
    branch: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    # transactions (from Supabase, full history)
    transactions: list = []
    total_in: float = 0.0
    total_out: float = 0.0