# backend/app/routers/explore.py
"""
Explore endpoints — two graph-structure features (read-only):

GET /explore/hierarchy        -> Region > City > Branch > Account tree (as in Neo4j),
                                 accounts enriched with model verdict + holder.
GET /explore/node/{id}        -> all direct transaction neighbours of one account
                                 (both directions) for click-to-expand exploration.
GET /explore/flagged-seeds    -> a few flagged accounts to seed the explorer.
"""
from typing import Optional, List
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.db.neo4j_client import neo4j_client
from app.db.supabase_client import supabase_client
from app.routers.predictions import _run_for_account

router = APIRouter(prefix="/explore", tags=["explore"])

# A model verdict only counts as a real flag if it is non-Normal AND the model is
# at least this confident. Below this, the top class is effectively a coin-flip,
# so we treat the account as unflagged (Normal) rather than show a misleading flag.
FLAG_CONFIDENCE_FLOOR = 0.50

_verdict_cache = {}


def _verdict(account_id: str):
    """(fraud_type, confidence) from the model, cached. None if Normal/unknown."""
    if account_id in _verdict_cache:
        return _verdict_cache[account_id]
    income = 0.0
    try:
        info = supabase_client.get_account(account_id)
        if info and info.get("customer"):
            income = float(info["customer"].get("declared_income") or 0.0)
    except Exception:
        pass
    v = _run_for_account(account_id, income)
    # honesty gate: drop low-confidence / Normal verdicts so they are not shown as flags
    if v is not None and (v.get("fraud_type") == "Normal" or float(v.get("confidence") or 0.0) < FLAG_CONFIDENCE_FLOOR):
        v = None
    _verdict_cache[account_id] = v
    return v


# ---------- Hierarchy ----------

class HAccount(BaseModel):
    account_id: str
    holder: Optional[str] = None
    person_id: Optional[str] = None  # for sharing one Person node across accounts
    fraud_type: Optional[str] = None
    confidence: Optional[float] = None
    flagged: bool = False


class HBranch(BaseModel):
    branch: str
    branch_id: Optional[str] = None
    accounts: List[HAccount]
    flagged_count: int = 0


class HCity(BaseModel):
    city: str
    branches: List[HBranch]
    flagged_count: int = 0


class HRegion(BaseModel):
    region: str
    cities: List[HCity]
    flagged_count: int = 0


class Hierarchy(BaseModel):
    regions: List[HRegion]
    total_accounts: int
    total_flagged: int


@router.get("/hierarchy", response_model=Hierarchy)
def hierarchy(limit: int = Query(2000, ge=10, le=5000),
              flagged_only: bool = Query(False)):
    rows = neo4j_client.fetch_hierarchy(limit=limit)

    # nested dict: region -> city -> (branch,branch_id) -> [accounts]
    tree = {}
    total_accounts = 0
    total_flagged = 0

    for r in rows:
        acc_id = r["account_id"]
        v = _verdict(acc_id)
        # confidence bar: a verdict below 0.5 is the model's weak top-guess, not a real flag
        CONF_BAR = 0.5
        if v is not None and float(v.get("confidence") or 0.0) < CONF_BAR:
            v = None
        flagged = v is not None
        if flagged_only and not flagged:
            continue
        total_accounts += 1
        if flagged:
            total_flagged += 1

        acc = HAccount(
            account_id=acc_id,
            holder=r.get("holder"),
            fraud_type=v["fraud_type"] if v else None,
            confidence=v["confidence"] if v else None,
            flagged=flagged,
        )
        reg = tree.setdefault(r["region"], {})
        cty = reg.setdefault(r["city"], {})
        bkey = (r["branch"], r.get("branch_id"))
        cty.setdefault(bkey, []).append(acc)

    regions = []
    for region_name, cities in sorted(tree.items()):
        city_objs = []
        region_flagged = 0
        for city_name, branches in sorted(cities.items()):
            branch_objs = []
            city_flagged = 0
            for (bname, bid), accts in sorted(branches.items()):
                bflag = sum(1 for a in accts if a.flagged)
                city_flagged += bflag
                branch_objs.append(HBranch(branch=bname, branch_id=bid,
                                           accounts=accts, flagged_count=bflag))
            region_flagged += city_flagged
            city_objs.append(HCity(city=city_name, branches=branch_objs, flagged_count=city_flagged))
        regions.append(HRegion(region=region_name, cities=city_objs, flagged_count=region_flagged))

    return Hierarchy(regions=regions, total_accounts=total_accounts, total_flagged=total_flagged)


# ---------- Node explorer ----------

class Neighbor(BaseModel):
    account_id: str
    holder: Optional[str] = None
    direction: str               # IN or OUT (relative to the clicked node)
    amount: float
    channel: Optional[str] = None
    timestamp: Optional[str] = None
    fraud_type: Optional[str] = None
    confidence: Optional[float] = None
    flagged: bool = False


class NodeInfo(BaseModel):
    account_id: str
    holder: Optional[str] = None
    branch: Optional[str] = None
    fraud_type: Optional[str] = None
    confidence: Optional[float] = None
    flagged: bool = False
    neighbors: List[Neighbor]


@router.get("/node/{account_id}", response_model=NodeInfo)
def node(account_id: str, limit: int = Query(60, ge=1, le=200)):
    try:
        raw = neo4j_client.fetch_node_neighbors(account_id, limit=limit)
    except Exception:
        raise HTTPException(503, "Graph service temporarily unavailable — please retry")

    holder = branch = None
    try:
        info = supabase_client.get_account(account_id)
        if info:
            holder = (info.get("customer") or {}).get("full_name")
            branch = (info.get("branch") or {}).get("branch_name")
    except Exception:
        pass
    v = _verdict(account_id)

    neighbors = []
    for n in raw["neighbors"]:
        nid = n["neighbor"]
        nv = _verdict(nid)
        nholder = None
        try:
            ninfo = supabase_client.get_account(nid)
            if ninfo and ninfo.get("customer"):
                nholder = ninfo["customer"].get("full_name")
        except Exception:
            pass
        neighbors.append(Neighbor(
            account_id=nid, holder=nholder, direction=n["direction"],
            amount=n["amount"], channel=n.get("channel"), timestamp=n.get("timestamp"),
            fraud_type=nv["fraud_type"] if nv else None,
            confidence=nv["confidence"] if nv else None,
            flagged=nv is not None,
        ))

    return NodeInfo(
        account_id=account_id, holder=holder, branch=branch,
        fraud_type=v["fraud_type"] if v else None,
        confidence=v["confidence"] if v else None,
        flagged=v is not None,
        neighbors=neighbors,
    )


@router.get("/flagged-seeds")
def flagged_seeds(limit: int = Query(8, ge=1, le=30)):
    """A handful of flagged accounts to seed the explorer's starting picker."""
    ids = neo4j_client.list_account_ids(limit=150)
    seeds = []
    for aid in ids:
        v = _verdict(aid)
        if v is not None:
            holder = None
            try:
                info = supabase_client.get_account(aid)
                if info and info.get("customer"):
                    holder = info["customer"].get("full_name")
            except Exception:
                pass
            seeds.append({"account_id": aid, "holder": holder,
                          "fraud_type": v["fraud_type"], "confidence": v["confidence"]})
            if len(seeds) >= limit:
                break
    return {"seeds": seeds}