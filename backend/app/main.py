import logging

from fastapi import FastAPI

from app.routers import health, questions, recordings

# Raise the root level to INFO so the processing-pipeline log lines are visible in
# uvicorn's output (and Render's log stream); the default WARNING would drop them.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Brevado API")

app.include_router(health.router)
app.include_router(recordings.router)
app.include_router(questions.router)
