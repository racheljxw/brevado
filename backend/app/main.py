from fastapi import FastAPI

from app.routers import health, recordings

app = FastAPI(title="Brevado API")

app.include_router(health.router)
app.include_router(recordings.router)
