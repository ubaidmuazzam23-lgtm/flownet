"""
FlowNet AI — model runner.

Loads the SHARED BiLSTM model + scaler and produces a fraud verdict for an
account. Faithful port of test_model_dpy.ipynb — no new rules, no thresholds.
The model decides; this code only feeds it.

Feature order per transaction: [amount, channel_code, time_gap, declared_income]
"""
import os
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import numpy as np
import joblib
import tensorflow as tf

from app.config import settings
from app.db.neo4j_client import neo4j_client

_ML_DIR = Path(__file__).resolve().parents[2] / "ml"
_MODEL_PATH = _ML_DIR / "advanced_fraud_bilstm.h5"
_SCALER_PATH = _ML_DIR / "fraud_scaler.pkl"


class ModelRunner:
    def __init__(self):
        self._model = None
        self._scaler = None

    def _load(self):
        if self._model is None:
            self._model = tf.keras.models.load_model(_MODEL_PATH, compile=False)
        if self._scaler is None:
            self._scaler = joblib.load(_SCALER_PATH)

    def _parse_time_gaps(self, timestamps):
        gaps = [0.0]
        for i in range(1, len(timestamps)):
            try:
                t0 = datetime.fromisoformat(str(timestamps[i - 1]))
                t1 = datetime.fromisoformat(str(timestamps[i]))
                gaps.append(abs((t1 - t0).total_seconds()) / 3600.0)
            except Exception:
                gaps.append(0.0)
        return gaps

    def predict_account(self, account_no: str, declared_income: float = 0.0):
        self._load()

        txns = neo4j_client.fetch_last_transactions(account_no)
        if not txns:
            return None

        timestamps = [t.get("timestamp") for t in txns]
        gaps = self._parse_time_gaps(timestamps)

        rows = []
        for t, gap in zip(txns, gaps):
            amount = float(t.get("amount") or 0.0)
            channel_code = settings.CHANNEL_MAP.get(t.get("channel"), 0)
            rows.append([amount, channel_code, gap, float(declared_income or 0.0)])

        seq = np.array(rows, dtype="float32")

        n = settings.SEQUENCE_LENGTH
        if len(seq) < n:
            pad = np.zeros((n - len(seq), 4), dtype="float32")
            seq = np.vstack([pad, seq])
        else:
            seq = seq[-n:]

        scaled = self._scaler.transform(seq)
        X = scaled.reshape(1, n, 4)

        prediction = self._model.predict(X, verbose=0)[0]
        idx = int(np.argmax(prediction))

        # REAL time span of the analysed transactions (from the DB)
        real_ts = [str(t) for t in timestamps if t]
        window_start = real_ts[0] if real_ts else None
        window_end = real_ts[-1] if real_ts else None

        return {
            "account_id": str(account_no),
            "fraud_type": settings.LABELS[idx],
            "confidence": float(prediction[idx]),
            "prediction_vector": [float(p) for p in prediction],
            "timestamp": str(datetime.now(timezone.utc)),  # when predicted
            "window_start": window_start,   # earliest real txn analysed
            "window_end": window_end,       # latest real txn analysed
            "txn_count": len(txns),         # how many real txns the model saw
        }


model_runner = ModelRunner()