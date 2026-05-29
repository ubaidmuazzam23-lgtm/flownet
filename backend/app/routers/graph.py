# backend/app/routers/graph.py
"""
Graph endpoints — fund-flow network with per-node model verdicts.

GET /graph?limit=N        -> full network, nodes enriched with verdict + holder/branch
GET /graph/trace/{id}     -> multi-hop OUTGOING money trail from one account
GET /graph/cycles         -> circular transactions (laundering loops), read-only,
                             each loop carries its own nodes + edges for drawing
"""
from fastapi import APIRouter, Query

from app.db.neo4j_client import neo4j_client
from app.db.supabase_client import supabase_client
from app.routers.predictions import _run_for_account
from app.aml.cycle_engine import cycle_engine
from app.schemas.graph import (
    GraphData, GraphNode, GraphEdge, TraceData,
    Cycle, CycleStep, CycleList,
)

router = APIRouter(prefix="/graph", tags=["graph"])

_node_cache = {}


def _enrich_node(nid: str) -> GraphNode:
    if nid in _node_cache:
        return _node_cache[nid]
    actor = branch = None
    income = 0.0
    try:
        info = supabase_client.get_account(nid)
        if info:
            cust = info.get("customer") or {}
            br = info.get("branch") or {}
            actor = cust.get("full_name")
            branch = br.get("branch_name")
            income = float(cust.get("declared_income") or 0.0)
    except Exception:
        pass
    verdict = _run_for_account(nid, income)
    node = GraphNode(
        id=nid, actor=actor, branch=branch,
        fraud_type=verdict["fraud_type"] if verdict else None,
        confidence=verdict["confidence"] if verdict else None,
    )
    _node_cache[nid] = node
    return node


@router.get("", response_model=GraphData)
def get_graph(limit: int = Query(150, ge=10, le=500)):
    raw = neo4j_client.fetch_graph(limit=limit)
    node_ids = {n["id"] for n in raw["nodes"]}
    nodes = [_enrich_node(nid) for nid in node_ids]
    edges = [GraphEdge(source=e["from"], target=e["to"], amount=e["amount"],
                       channel=e.get("channel"), timestamp=e.get("timestamp")) for e in raw["edges"]]
    return GraphData(nodes=nodes, edges=edges)


@router.get("/trace/{account_id}", response_model=TraceData)
def trace_account(account_id: str, hops: int = Query(3, ge=1, le=4), limit: int = Query(200, ge=10, le=500)):
    raw = neo4j_client.fetch_trace(account_id, hops=hops, limit=limit)
    node_ids = {n["id"] for n in raw["nodes"]}
    nodes = [_enrich_node(nid) for nid in node_ids]
    edges = [GraphEdge(source=e["from"], target=e["to"], amount=e["amount"],
                       channel=e.get("channel"), timestamp=e.get("timestamp"), hop=e.get("hop")) for e in raw["edges"]]
    max_hop = max([e.hop or 1 for e in edges], default=1)
    total = sum(e.amount for e in edges if e.hop == 1 and e.source == raw["origin"])
    return TraceData(origin=raw["origin"], nodes=nodes, edges=edges, max_hop=max_hop, total_traced=total)


@router.get("/cycles", response_model=CycleList)
def detect_cycles(limit: int = Query(1000, ge=50, le=5000)):
    raw_cycles = cycle_engine.detect_cycles(limit=limit)
    cycles = []
    for c in raw_cycles:
        # unique accounts in the loop (drop the closing duplicate for node enrichment)
        uniq = []
        for a in c["path"]:
            if a not in uniq:
                uniq.append(a)
        nodes = [_enrich_node(a) for a in uniq]
        steps = [CycleStep(account_id=n.id, actor=n.actor) for n in nodes]
        edges = [GraphEdge(source=e["source"], target=e["target"], amount=e["amount"],
                           channel=e.get("channel"), timestamp=e.get("timestamp")) for e in c["edges"]]
        cycles.append(Cycle(
            path=steps, nodes=nodes, edges=edges,
            amount=c["amount"], hops=c["hops"],
            similarity=c.get("similarity", 0.0),
            duration_hours=c.get("duration_hours"),
            fast=c.get("fast", False),
        ))
    cycles.sort(key=lambda x: x.amount, reverse=True)
    return CycleList(cycles=cycles, total=len(cycles))