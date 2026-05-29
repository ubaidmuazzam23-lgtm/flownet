# backend/app/ml/tgn_runner.py
"""
FlowNet AI — TGN (Temporal Graph Network) runner for RAPID LAYERING detection.

This is the project's SECOND deep-learning model (alongside the BiLSTM).
The TGN scores TRANSACTIONS (edges): for an edge src->dst at time t with 5
engineered features, it returns P(layering). Memory is built by replaying the
account's recent transactions in time order, exactly as the model was trained.

Faithful to the teammate's training/inference code:
  * TimeEncoder: cos(Linear(1->time_dim))
  * Memory: per-node GRUCell, input = [m_src, m_dst, edge_feats, time_enc(dt)]
  * Classifier MLP on [m_src, m_dst]  (matches the SAVED weights: in_dim = 2*mem)
  * Features: ['amount_log','hour','is_weekend','is_fast_chan','is_api_chan'],
    scaled by the bundled StandardScaler; flag if prob >= best_thr.

IMPORTANT (honest scope): the model was trained on a fixed id_map of 80 accounts.
It can only score transactions whose BOTH endpoints are in id_map. Accounts
outside the trained set are skipped (no trained memory) — reported as 'unscored',
never faked.
"""
import os
import math
from pathlib import Path
from typing import Optional, List, Dict
import numpy as np

_ML_DIR = Path(__file__).resolve().parents[2] / "ml"
_TGN_PATH = _ML_DIR / "tgn_layering.pt"

_TORCH_OK = True
try:
    import torch
    import torch.nn as nn
except Exception:
    _TORCH_OK = False

# ----- model definition (matches the saved weights exactly) -----
if _TORCH_OK:
    class TimeEncoder(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.w = nn.Linear(1, dim)
        def forward(self, t):
            return torch.cos(self.w(t.view(-1, 1).float()))

    class TGNMemory(nn.Module):
        def __init__(self, n_nodes, mem_dim, msg_dim):
            super().__init__()
            self.mem_dim = mem_dim
            self.register_buffer("memory", torch.zeros(n_nodes, mem_dim))
            self.register_buffer("last_t", torch.zeros(n_nodes))
            self.gru = nn.GRUCell(msg_dim, mem_dim)

    class TGNLayeringModel(nn.Module):
        def __init__(self, n_nodes, edge_dim, mem_dim=64, hidden=64, time_dim=16):
            super().__init__()
            self.time_enc = TimeEncoder(time_dim)
            self.memory = TGNMemory(n_nodes, mem_dim, 2 * mem_dim + edge_dim + time_dim)
            self.mlp = nn.Sequential(
                nn.Linear(2 * mem_dim, hidden), nn.ReLU(), nn.Dropout(0.2),
                nn.Linear(hidden, 32), nn.ReLU(), nn.Linear(32, 1),
            )

        @torch.no_grad()
        def score_edge(self, src_idx, dst_idx):
            emb = torch.cat([self.memory.memory[src_idx], self.memory.memory[dst_idx]])
            return float(torch.sigmoid(self.mlp(emb.unsqueeze(0))).item())

        @torch.no_grad()
        def update(self, src_idx, dst_idx, t, msg_vec):
            m_src = self.memory.memory[src_idx]
            m_dst = self.memory.memory[dst_idx]
            dt = torch.clamp(torch.tensor([t - float(self.memory.last_t[src_idx].item())]), min=0)
            te = self.time_enc(dt).squeeze(0)
            raw = torch.cat([m_src, m_dst, torch.tensor(msg_vec, dtype=torch.float32), te])
            new_m = self.memory.gru(raw.unsqueeze(0), m_src.unsqueeze(0)).squeeze(0)
            self.memory.memory[src_idx] = new_m.detach()
            self.memory.last_t[src_idx] = float(t)

        def reset(self):
            self.memory.memory.zero_()
            self.memory.last_t.zero_()


# ----- channel/type feature helpers (faithful to training) -----
def _edge_features(amount: float, hour: int, is_weekend: int,
                   transaction_type: Optional[str], channel: Optional[str]) -> List[float]:
    return [
        math.log1p(max(0.0, amount)),
        float(hour),
        float(is_weekend),
        float((transaction_type or "").upper() in ("IMPS", "UPI")),
        float((channel or "").upper() in ("API", "MOBILE")),
    ]


class TGNRunner:
    def __init__(self):
        self.model = None
        self.id_map: Dict = {}
        self.scaler = None
        self.cols: List[str] = []
        self.threshold = 0.5
        self.loaded = False
        self.error: Optional[str] = None
        self._file_missing = False

    def load(self, path: str):
        if not _TORCH_OK:
            self.error = "PyTorch not installed in backend env"
            return
        if not os.path.exists(path):
            # transient: file may be placed later — record but allow retry
            self.error = f"TGN model file not found: {path}"
            self._file_missing = True
            return
        self._file_missing = False
        try:
            ckpt = torch.load(path, map_location="cpu", weights_only=False)
            mp = ckpt["model_params"]
            self.model = TGNLayeringModel(
                n_nodes=mp["n_nodes"], edge_dim=mp["edge_dim"],
                mem_dim=mp["mem_dim"], hidden=mp["hidden"], time_dim=mp["time_dim"],
            )
            self.model.load_state_dict(ckpt["model_state"], strict=False)
            self.model.eval()
            # id_map keys may be ints (account ids) -> normalize to str
            self.id_map = {str(k): int(v) for k, v in ckpt["id_map"].items()}
            self.scaler = ckpt["scaler_edge"]
            self.cols = ckpt["edge_feat_cols"]
            self.threshold = float(ckpt["best_thr"])
            self.loaded = True
        except Exception as e:
            self.error = f"Failed to load TGN: {e}"

    def ensure(self):
        """Lazy-load the bundled model from backend/ml/tgn_layering.pt on first use.
        Retries if a previous attempt only failed because the file was missing."""
        if not self.loaded and (self.error is None or getattr(self, "_file_missing", False)):
            self.error = None
            self.load(str(_TGN_PATH))
        return self.loaded

    # account_no in the graph is 15-digit (100000000000001); the model's id_map
    # was trained on the compact form (1..80). Resolve by trying raw then stripped.
    _BASE = 100000000000000

    def _resolve(self, account_id: str):
        s = str(account_id).strip()
        if s in self.id_map:
            return self.id_map[s]
        # try integer + base-stripped integer
        try:
            n = int(float(s))
        except (TypeError, ValueError):
            return None
        for cand in (str(n), str(n - self._BASE)):
            if cand in self.id_map:
                return self.id_map[cand]
        return None

    def knows(self, account_id: str) -> bool:
        return self._resolve(account_id) is not None

    def score_transactions(self, txns: List[dict]) -> List[dict]:
        """
        txns: ordered (oldest first) list of dicts with keys:
              from_account, to_account, amount, timestamp(unix or str->we pass unix),
              transaction_type, channel, hour, is_weekend
        Returns the same transactions annotated with layering probability + flag,
        for edges where BOTH endpoints are in the trained id_map. Others are skipped.
        Memory is replayed in order (stateful), matching training.
        """
        if not self.ensure():
            return []
        self.model.reset()
        out = []
        # batch-scale all feature rows once
        raw = []
        for tx in txns:
            raw.append(_edge_features(
                float(tx.get("amount") or 0.0),
                int(tx.get("hour") or 0),
                int(tx.get("is_weekend") or 0),
                tx.get("transaction_type"),
                tx.get("channel"),
            ))
        scaled = self.scaler.transform(np.array(raw, dtype=float)) if raw else []

        for i, tx in enumerate(txns):
            s = str(tx["from_account"]); d = str(tx["to_account"])
            si = self._resolve(s); di = self._resolve(d)
            if si is None or di is None:
                continue  # unscored — not in trained set (never faked)
            t_unix = float(tx.get("t_unix") or 0.0)
            prob = self.model.score_edge(si, di)
            self.model.update(si, di, t_unix, scaled[i])
            out.append({
                "from_account": s, "to_account": d,
                "amount": float(tx.get("amount") or 0.0),
                "channel": tx.get("channel"),
                "timestamp": tx.get("timestamp"),
                "layering_prob": round(prob, 4),
                "is_layering": prob >= self.threshold,
            })
        return out


tgn_runner = TGNRunner()