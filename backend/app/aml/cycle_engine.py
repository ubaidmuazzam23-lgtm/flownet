# backend/app/aml/cycle_engine.py
"""
FlowNet AI — AML Cycle Detection (read-only, on-demand).

Faithful extension of the teammate's aml_memory_engine.py detection logic
(flow-continuity + reachability + cycle check), adapted to be:
  * READ-ONLY  — never writes SuspiciousCycle nodes back to Neo4j
  * ON-DEMAND  — runs once when called, no infinite polling loop

Covers the circular-pattern spec:
  "funds return to the original source through intermediary accounts with
   SIMILAR AMOUNTS and SHORT DURATIONS."

How each spec trait is enforced:
  * "returns to origin"   -> cycle detection (path closes back to start)
  * "similar amounts"     -> per-hop flow-continuity ratio in [FLOW_THRESHOLD, FLOW_UPPER]
                             (each hop keeps a near-equal amount; small fee/cut allowed)
  * "short durations"     -> total loop duration computed from real timestamps;
                             loops tagged fast/slow against TIME_WINDOW_HOURS
  * "splits / fan-out"    -> each account remembers MULTIPLE recent incoming flows,
                             so A->B then B->{C,D,E} branches are all followed

A cycle is reported with its ordered accounts AND the real per-hop transfers
(amount/channel/timestamp) so the frontend can draw the full closed loop.
"""
from typing import List, Dict, Optional
from datetime import datetime
from app.db.neo4j_client import neo4j_client
from app.config import settings

# --- tunables (match the spec's "near amounts, short durations") ---
FLOW_THRESHOLD = 0.80      # min hop ratio amount_out/amount_in (>= this = "similar")
FLOW_UPPER = 1.25          # max hop ratio: reject hops where money balloons (not pass-through)
TIME_WINDOW_HOURS = 72.0   # loops closing within this many hours are flagged "fast"
MAX_RECENT_PER_NODE = 6    # recent incoming flows remembered per account (enables fan-out)

_TS_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%d",
]


def _parse_ts(ts) -> Optional[datetime]:
    if ts is None:
        return None
    s = str(ts).replace("Z", "").strip()
    if "+" in s[10:]:
        s = s[:10] + s[10:].split("+")[0]
    for fmt in _TS_FORMATS:
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return None


class CycleEngine:
    def __init__(self, flow_threshold: float = FLOW_THRESHOLD,
                 flow_upper: float = FLOW_UPPER,
                 time_window_hours: float = TIME_WINDOW_HOURS):
        self.flow_threshold = flow_threshold
        self.flow_upper = flow_upper
        self.time_window_hours = time_window_hours

    def _fetch_ordered_transactions(self, limit: int = 1000):
        query = """
            MATCH (a:Account)-[t:TRANSACTION]->(b:Account)
            RETURN toString(a.account_no) AS from_account,
                   toString(b.account_no) AS to_account,
                   t.amount AS amount,
                   t.timestamp AS timestamp,
                   t.channel AS channel
            ORDER BY t.timestamp ASC
            LIMIT $limit
        """
        driver = neo4j_client.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            return [dict(r) for r in session.run(query, limit=limit)]

    def _fetch_edge(self, from_acc: str, to_acc: str):
        """Direct lookup of the real transfer between two accounts (largest)."""
        query = """
            MATCH (a:Account)-[t:TRANSACTION]->(b:Account)
            WHERE toString(a.account_no) = $f AND toString(b.account_no) = $t
            RETURN t.amount AS amount, t.channel AS channel, t.timestamp AS timestamp
            ORDER BY t.amount DESC
            LIMIT 1
        """
        driver = neo4j_client.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            rec = session.run(query, f=str(from_acc), t=str(to_acc)).single()
            if rec:
                return {"amount": float(rec["amount"]) if rec["amount"] is not None else 0.0,
                        "channel": rec["channel"], "timestamp": str(rec["timestamp"])}
        return None

    def detect_cycles(self, limit: int = 1000) -> List[Dict]:
        txns = self._fetch_ordered_transactions(limit=limit)

        edge_lookup: Dict[tuple, dict] = {}
        for tx in txns:
            f, t = str(tx["from_account"]), str(tx["to_account"])
            try:
                amt = float(tx["amount"])
            except (TypeError, ValueError):
                continue
            key = (f, t)
            if key not in edge_lookup or amt > edge_lookup[key]["amount"]:
                edge_lookup[key] = {"amount": amt, "channel": tx.get("channel"),
                                    "timestamp": str(tx.get("timestamp"))}

        # each node remembers a LIST of recent incoming flows (enables fan-out / splits)
        recent_in: Dict[str, list] = {}
        reachability: Dict[str, Dict[str, list]] = {}
        cycles: List[Dict] = []
        seen = set()

        def store_reach(origin, receiver, path):
            reachability.setdefault(origin, {}).setdefault(receiver, [])
            if path not in reachability[origin][receiver]:
                reachability[origin][receiver].append(path)

        def build_edges(path):
            edges = []
            total = 0.0
            amounts = []
            ts_list = []
            for i in range(len(path) - 1):
                f, t = path[i], path[i + 1]
                e = edge_lookup.get((f, t))
                if e is None:
                    e = self._fetch_edge(f, t)
                amt = e["amount"] if e else 0.0
                total += amt
                amounts.append(amt)
                if e and e.get("timestamp"):
                    ts_list.append(_parse_ts(e["timestamp"]))
                edges.append({
                    "source": f, "target": t,
                    "amount": amt,
                    "channel": e["channel"] if e else None,
                    "timestamp": e["timestamp"] if e else None,
                })
            return edges, total, amounts, ts_list

        def amount_similarity(amounts):
            vals = [a for a in amounts if a > 0]
            if not vals:
                return 0.0
            return min(vals) / max(vals)

        def duration_hours(ts_list):
            valid = [t for t in ts_list if t is not None]
            if len(valid) < 2:
                return None
            return (max(valid) - min(valid)).total_seconds() / 3600.0

        def _canonical(closed):
            """Rotation-invariant key so A->B->C->A and B->C->A->B aren't double-counted."""
            core = closed[:-1] if closed[0] == closed[-1] else closed[:]
            if not core:
                return tuple(closed)
            n = len(core)
            rots = ["|".join(core[i:] + core[:i]) for i in range(n)]
            return min(rots)

        def emit_cycle(closed):
            if closed[0] != closed[-1]:
                closed = closed + [closed[0]]
            ckey = _canonical(closed)
            if ckey in seen:
                return
            seen.add(ckey)
            edges, total, amounts, ts_list = build_edges(closed)
            dur = duration_hours(ts_list)
            cycles.append({
                "path": closed,
                "edges": edges,
                "amount": total,
                "hops": len(closed) - 1,
                "similarity": round(amount_similarity(amounts), 3),
                "duration_hours": round(dur, 2) if dur is not None else None,
                "fast": (dur is not None and dur <= self.time_window_hours),
            })

        for tx in txns:
            sender = str(tx["from_account"])
            receiver = str(tx["to_account"])
            try:
                amount = float(tx["amount"])
            except (TypeError, ValueError):
                continue
            if amount <= 0:
                continue

            extended_flows = []  # chains that now reach `receiver`, to remember forward
            for prev in recent_in.get(sender, []):
                incoming_amount = prev["amount"]
                origin = prev["origin"]
                prev_path = prev["path"]
                if incoming_amount <= 0:
                    continue

                ratio = amount / incoming_amount
                # "similar amount": within [threshold, upper] (small fee/cut ok, no ballooning)
                if ratio < self.flow_threshold or ratio > self.flow_upper:
                    continue
                if receiver in prev_path and receiver != origin:
                    continue  # avoid degenerate re-visits (except closing to origin)

                new_path = prev_path + [receiver]
                store_reach(origin, receiver, new_path)

                if receiver == origin:
                    emit_cycle(new_path)                      # closed straight back to origin
                else:
                    # carry the CHAIN (its true origin + full path) forward from receiver
                    extended_flows.append({
                        "amount": amount, "origin": origin,
                        "path": new_path, "start_ts": _parse_ts(tx.get("timestamp")),
                    })
                    if receiver in reachability and origin in reachability.get(receiver, {}):
                        for p in reachability[receiver][origin]:
                            tail = p[1:] if p and p[0] == receiver else p
                            emit_cycle(new_path + tail)
                            break

            lst = recent_in.setdefault(receiver, [])
            # record the raw immediate inflow (origin = direct sender) ...
            lst.append({
                "amount": amount, "origin": sender,
                "path": [sender, receiver], "start_ts": _parse_ts(tx.get("timestamp")),
            })
            # ... plus any extended chains that now pass through receiver
            lst.extend(extended_flows)
            if len(lst) > MAX_RECENT_PER_NODE:
                del lst[0:len(lst) - MAX_RECENT_PER_NODE]

        return cycles


cycle_engine = CycleEngine()