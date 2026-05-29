# clean_model.py — run once from backend/ to strip the newer-Keras
# 'quantization_config' field so Keras 3.10 can load the model.
# Usage:  python clean_model.py
import h5py
import json

PATH = "ml/advanced_fraud_bilstm.h5"

def strip_quant(obj):
    """Recursively remove 'quantization_config' keys from the config dict."""
    if isinstance(obj, dict):
        obj.pop("quantization_config", None)
        for v in obj.values():
            strip_quant(v)
    elif isinstance(obj, list):
        for v in obj:
            strip_quant(v)

with h5py.File(PATH, "r+") as f:
    raw = f.attrs.get("model_config")
    if raw is None:
        print("No model_config attr found — nothing to clean.")
    else:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        config = json.loads(raw)
        strip_quant(config)
        f.attrs.modify("model_config", json.dumps(config))
        print("Cleaned 'quantization_config' from model_config. Saved in place.")