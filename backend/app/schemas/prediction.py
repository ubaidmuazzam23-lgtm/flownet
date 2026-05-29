# backend/app/schemas/prediction.py
"""Pydantic response shapes for predictions. Frontend types mirror these."""
from typing import Optional, List
from pydantic import BaseModel


class Prediction(BaseModel):
    account_id: str
    fraud_type: str
    confidence: float
    prediction_vector: List[float]
    timestamp: str
    actor: Optional[str] = None
    branch: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    txn_count: Optional[int] = None


class PredictionList(BaseModel):
    items: List[Prediction]
    total: int


class TxnRow(BaseModel):
    amount: float
    channel: Optional[str] = None
    timestamp: str
    direction: Optional[str] = None
    counterparty: Optional[str] = None


class PredictionDetail(BaseModel):
    prediction: Prediction
    transactions: List[TxnRow]
    occupation: Optional[str] = None
    declared_income: Optional[float] = None
    customer_since: Optional[str] = None
    account_status: Optional[str] = None
    account_type: Optional[str] = None