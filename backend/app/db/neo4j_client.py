# backend/app/db/neo4j_client.py
"""
FlowNet AI — Neo4j read-only client. NEVER writes.
Account key: account_no | TRANSACTION edge props: amount, timestamp, channel, direction
"""
from typing import Optional
from neo4j import GraphDatabase
from app.config import settings


class Neo4jClient:
    def __init__(self):
        self._driver = None

    def connect(self):
        if self._driver is None:
            self._driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD),
            )
        return self._driver

    def close(self):
        if self._driver is not None:
            self._driver.close()
            self._driver = None

    def fetch_last_transactions(self, account_no, limit: Optional[int] = None):
        limit = limit or settings.SEQUENCE_LENGTH
        query = """
            MATCH (a:Account)-[t:TRANSACTION]-(other:Account)
            WHERE toString(a.account_no) = $account_no
            RETURN t.amount AS amount, t.channel AS channel,
                   t.timestamp AS timestamp, t.direction AS direction,
                   toString(other.account_no) AS counterparty
            ORDER BY t.timestamp ASC
            LIMIT $limit
        """
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            result = session.run(query, account_no=str(account_no), limit=limit)
            return [dict(record) for record in result]

    def fetch_graph(self, limit: int = 200):
        query = """
            MATCH (a:Account)-[t:TRANSACTION]->(b:Account)
            RETURN toString(a.account_no) AS from_id,
                   toString(b.account_no) AS to_id,
                   t.amount AS amount, t.timestamp AS timestamp,
                   t.channel AS channel, t.direction AS direction
            LIMIT $limit
        """
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            rows = [dict(r) for r in session.run(query, limit=limit)]

        node_ids = set()
        edges = []
        for r in rows:
            node_ids.add(r["from_id"]); node_ids.add(r["to_id"])
            edges.append({
                "from": r["from_id"], "to": r["to_id"],
                "amount": float(r["amount"]) if r["amount"] is not None else 0.0,
                "timestamp": str(r["timestamp"]), "channel": r["channel"],
                "direction": r["direction"],
            })
        return {"nodes": [{"id": n} for n in node_ids], "edges": edges}

    def fetch_trace(self, account_no: str, hops: int = 3, limit: int = 200):
        """
        Multi-hop OUTGOING money trail from an account, up to `hops` deep.
        Follows TRANSACTION direction (a)-[t]->(b). Returns nodes + directed edges
        with the hop distance of each edge from the origin.
        """
        hops = max(1, min(4, hops))
        query = f"""
            MATCH path = (start:Account)-[:TRANSACTION*1..{hops}]->(end:Account)
            WHERE toString(start.account_no) = $account_no
            WITH relationships(path) AS rels
            UNWIND range(0, size(rels)-1) AS i
            WITH rels[i] AS r, i AS hop
            WITH startNode(r) AS a, endNode(r) AS b, r, hop
            RETURN DISTINCT
                toString(a.account_no) AS from_id,
                toString(b.account_no) AS to_id,
                r.amount AS amount, r.channel AS channel,
                r.timestamp AS timestamp, hop AS hop
            LIMIT $limit
        """
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            rows = [dict(r) for r in session.run(query, account_no=str(account_no), limit=limit)]

        node_ids = set()
        edges = []
        for r in rows:
            node_ids.add(r["from_id"]); node_ids.add(r["to_id"])
            edges.append({
                "from": r["from_id"], "to": r["to_id"],
                "amount": float(r["amount"]) if r["amount"] is not None else 0.0,
                "channel": r["channel"], "timestamp": str(r["timestamp"]),
                "hop": int(r["hop"]) + 1,
            })
        node_ids.add(str(account_no))
        return {"nodes": [{"id": n} for n in node_ids], "edges": edges, "origin": str(account_no)}

    def list_account_ids(self, limit: int = 100):
        query = "MATCH (a:Account) RETURN toString(a.account_no) AS id LIMIT $limit"
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            return [r["id"] for r in session.run(query, limit=limit)]


    def fetch_transactions_for_tgn(self, limit: int = 2000):
        """
        All transactions, oldest-first, with the raw fields the TGN needs.
        transaction_type is read if present (for is_fast_chan); channel for is_api_chan.
        """
        query = """
            MATCH (a:Account)-[t:TRANSACTION]->(b:Account)
            RETURN toString(a.account_no) AS from_account,
                   toString(b.account_no) AS to_account,
                   t.amount AS amount,
                   t.timestamp AS timestamp,
                   t.channel AS channel,
                   t.transaction_type AS transaction_type
            ORDER BY t.timestamp ASC
            LIMIT $limit
        """
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            return [dict(r) for r in session.run(query, limit=limit)]

    def fetch_hierarchy(self, limit: int = 2000):
        """
        Org hierarchy exactly as in Neo4j: Region -> City -> Branch -> Account.
          (Region)-[:HAS_CITY]->(City)-[:HAS_BRANCH]->(Branch)-[:HAS_ACCOUNT]->(Account)
        Returns flat rows; the router assembles the nested tree and enriches
        each account with its model verdict + holder name.
        Accounts whose branch chain is incomplete still surface under their branch.
        """
        query = """
            MATCH (br:Branch)-[:HAS_ACCOUNT]->(a:Account)
            OPTIONAL MATCH (ci:City)-[:HAS_BRANCH]->(br)
            OPTIONAL MATCH (re:Region)-[:HAS_CITY]->(ci)
            OPTIONAL MATCH (p:Person)-[:OWNS]->(a)
            RETURN
                coalesce(re.region_name, re.name, 'Unknown Region') AS region,
                coalesce(ci.city_name, ci.name, 'Unknown City')   AS city,
                coalesce(br.branch_name, br.name, toString(br.branch_id)) AS branch,
                toString(br.branch_id) AS branch_id,
                toString(a.account_no) AS account_id,
                p.name AS holder,
                coalesce(toString(p.person_id), toString(id(p)), p.name) AS person_id
            ORDER BY region, city, branch, account_id
            LIMIT $limit
        """
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            return [dict(r) for r in session.run(query, limit=limit)]

    def fetch_node_neighbors(self, account_no: str, limit: int = 60):
        """
        All DIRECT transaction neighbours of one account (both directions),
        for the click-to-expand explorer. Each neighbour edge carries the real
        amount/channel/timestamp and which way the money moved.
        """
        query = """
            MATCH (a:Account)-[t:TRANSACTION]-(b:Account)
            WHERE toString(a.account_no) = $account_no
            WITH a, t, b,
                 CASE WHEN startNode(t) = a THEN 'OUT' ELSE 'IN' END AS direction
            RETURN DISTINCT
                toString(b.account_no) AS neighbor,
                direction,
                t.amount AS amount,
                t.channel AS channel,
                t.timestamp AS timestamp
            ORDER BY t.amount DESC
            LIMIT $limit
        """
        driver = self.connect()
        with driver.session(database=settings.NEO4J_DATABASE) as session:
            rows = [dict(r) for r in session.run(query, account_no=str(account_no), limit=limit)]
        neighbors = []
        for r in rows:
            neighbors.append({
                "neighbor": r["neighbor"],
                "direction": r["direction"],
                "amount": float(r["amount"]) if r["amount"] is not None else 0.0,
                "channel": r["channel"],
                "timestamp": str(r["timestamp"]),
            })
        return {"account_id": str(account_no), "neighbors": neighbors}


neo4j_client = Neo4jClient()