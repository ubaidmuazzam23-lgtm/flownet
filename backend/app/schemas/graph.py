# backend/app/schemas/graph.py
"""Graph response shapes for the fund-flow view."""
from typing import Optional, List
from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    actor: Optional[str] = None
    branch: Optional[str] = None
    fraud_type: Optional[str] = None
    confidence: Optional[float] = None


class GraphEdge(BaseModel):
    source: str
    target: str
    amount: float
    channel: Optional[str] = None
    timestamp: Optional[str] = None
    hop: Optional[int] = None


class GraphData(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class TraceData(BaseModel):
    origin: str
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    max_hop: int
    total_traced: float


class CycleStep(BaseModel):
    account_id: str
    actor: Optional[str] = None


class Cycle(BaseModel):
    path: List[CycleStep]        # ordered accounts, closes back to first
    nodes: List[GraphNode]       # enriched nodes (verdict + holder) for drawing
    edges: List[GraphEdge]       # real per-hop transfers for drawing
    amount: float                # total value moved around the loop
    hops: int
    similarity: float = 0.0              # min/max hop amount ratio (1.0 = identical)
    duration_hours: Optional[float] = None  # span of the loop from real timestamps
    fast: bool = False                   # closed within the AML time window


class CycleList(BaseModel):
    cycles: List[Cycle]
    total: int