from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="Brevado API")

app.include_router(health.router)
