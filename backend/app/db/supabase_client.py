# backend/app/db/supabase_client.py
"""
FlowNet AI — Supabase (Postgres) read-only client. NEVER writes.

Hardened against transient HTTP/2 read errors (Errno 35 / ReadError) which
occur on flaky networks: every query retries a couple of times before giving up.

Schema:
  customers(customer_id, full_name, declared_income, occupation, customer_since)
  accounts (account_id, branch_id, product_id, account_type, customer_id, created_date, status)
  transactions(transaction_id, from_account_id, to_account_id, amount,
               transaction_type, timestamp, channel, transaction_direction)
  branchs  (branch_id, branch_name, city, region)
  products (product_id, product_name, category, risk_factor)
"""
import time
from typing import Optional
from supabase import create_client, Client
from app.config import settings

_MAX_RETRIES = 3
_RETRY_DELAY = 0.4  # seconds


def _retry(fn):
    """Run a Supabase call, retrying on transient connection errors."""
    last = None
    for attempt in range(_MAX_RETRIES):
        try:
            return fn()
        except Exception as e:  # httpx.ReadError, ConnectError, etc.
            last = e
            msg = str(e).lower()
            transient = any(k in msg for k in
                            ["temporarily unavailable", "readerror", "read error",
                             "connection", "timeout", "errno 35", "reset"])
            if not transient or attempt == _MAX_RETRIES - 1:
                raise
            time.sleep(_RETRY_DELAY * (attempt + 1))
    if last:
        raise last


class SupabaseClient:
    def __init__(self):
        self._client: Optional[Client] = None

    def connect(self) -> Client:
        if self._client is None:
            self._client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        return self._client

    def get_account(self, account_id: str):
        c = self.connect()
        acc = _retry(lambda: c.table("accounts").select("*").eq("account_id", account_id).limit(1).execute())
        if not acc.data:
            return None
        account = acc.data[0]

        customer = None
        if account.get("customer_id") is not None:
            cust = _retry(lambda: c.table("customers").select("*").eq("customer_id", account["customer_id"]).limit(1).execute())
            customer = cust.data[0] if cust.data else None

        branch = None
        if account.get("branch_id"):
            br = _retry(lambda: c.table("branchs").select("*").eq("branch_id", account["branch_id"]).limit(1).execute())
            branch = br.data[0] if br.data else None

        return {"account": account, "customer": customer, "branch": branch}

    def get_account_transactions(self, account_id: str, limit: int = 100):
        c = self.connect()
        sent = (_retry(lambda: c.table("transactions").select("*")
                       .eq("from_account_id", account_id)
                       .order("timestamp", desc=True).limit(limit).execute())).data or []
        recv = (_retry(lambda: c.table("transactions").select("*")
                       .eq("to_account_id", account_id)
                       .order("timestamp", desc=True).limit(limit).execute())).data or []
        for t in sent:
            t["_dir"] = "OUT"
        for t in recv:
            t["_dir"] = "IN"
        all_txns = sent + recv
        all_txns.sort(key=lambda t: str(t.get("timestamp")), reverse=True)
        return all_txns[:limit]

    def list_accounts(self, limit: int = 100):
        c = self.connect()
        accounts = (_retry(lambda: c.table("accounts").select("*").limit(limit).execute())).data or []

        cust_ids = list({a["customer_id"] for a in accounts if a.get("customer_id") is not None})
        br_ids = list({a["branch_id"] for a in accounts if a.get("branch_id")})

        cust_map = {}
        if cust_ids:
            custs = (_retry(lambda: c.table("customers").select("customer_id,full_name").in_("customer_id", cust_ids).execute())).data or []
            cust_map = {x["customer_id"]: x["full_name"] for x in custs}

        br_map = {}
        if br_ids:
            brs = (_retry(lambda: c.table("branchs").select("branch_id,branch_name").in_("branch_id", br_ids).execute())).data or []
            br_map = {x["branch_id"]: x["branch_name"] for x in brs}

        out = []
        for a in accounts:
            out.append({
                "account_id": str(a["account_id"]),
                "account_type": a.get("account_type"),
                "status": a.get("status"),
                "branch": br_map.get(a.get("branch_id")),
                "actor": cust_map.get(a.get("customer_id")),
            })
        return out


supabase_client = SupabaseClient()