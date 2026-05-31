# backend/app/main.py
"""FlowNet AI — FastAPI entrypoint."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.neo4j_client import neo4j_client
from app.routers import predictions, accounts, graph, explore, layering, reports, dashboard

app = FastAPI(title="FlowNet AI", version="0.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/")
def health():
    return {"status": "running", "service": "FlowNet AI"}


app.include_router(predictions.router)
app.include_router(accounts.router)
app.include_router(graph.router)
app.include_router(explore.router)
app.include_router(layering.router)
app.include_router(reports.router)
app.include_router(dashboard.router)


@app.on_event("shutdown")
def _shutdown():
    neo4j_client.close()