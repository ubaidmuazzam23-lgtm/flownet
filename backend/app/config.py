"""
FlowNet AI — configuration.
Loads environment variables. No secrets are hardcoded here.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ---- Supabase / Postgres (read-only) ----
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # ---- Neo4j (read-only) ----
    NEO4J_URI: str = os.getenv("NEO4J_URI", "")
    NEO4J_USERNAME: str = os.getenv("NEO4J_USERNAME", "")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "")
    NEO4J_DATABASE: str = os.getenv("NEO4J_DATABASE", "neo4j")

    # ---- Clerk (auth) ----
    CLERK_SECRET_KEY: str = os.getenv("CLERK_SECRET_KEY", "")
    CLERK_JWKS_URL: str = os.getenv("CLERK_JWKS_URL", "")

    # ---- App ----
    # CORS origin for the Vite dev server
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

    # ---- Model / graph constants (CONFIRMED from your Neo4j + notebook) ----
    # The property name that identifies an Account node in the graph.
    # Confirmed from console.neo4j.io: Account nodes use `account_no`.
    GRAPH_ACCOUNT_KEY: str = "account_no"

    # Number of transactions the BiLSTM expects (confirmed: input shape (None, 30, 4)).
    SEQUENCE_LENGTH: int = 30

    # The model's 6 output classes, in order (confirmed from test_model_dpy.ipynb).
    LABELS = ["Normal", "Structuring", "Dormant",
              "Velocity Spike", "Sleeping Beauty", "Micro+Drain"]

    # Channel encoding (confirmed from notebook CHANNEL_MAP).
    # NOTE: real data also contains "BRANCH", which is NOT in this map.
    # The model falls back to 0 (ATM) for any unknown channel — faithful to shared logic.
    CHANNEL_MAP = {
        "ATM": 0, "UPI": 1, "NEFT": 2, "RTGS": 3,
        "IMPS": 4, "CARD": 5, "ONLINE": 6, "MOBILE": 7,
    }


settings = Settings()