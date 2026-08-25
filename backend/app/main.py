import logging

from fastapi import FastAPI

from app.routers import health, recordings

# Root logging config for the whole app — INFO and above show up wherever uvicorn's
# own output goes. Added in Phase 2 Step 3 so the app/services/processing.py logging
# around the (now real) Gemini call is actually visible when running locally/on Render,
# not silently dropped by the default WARNING root level.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Brevado API")

app.include_router(health.router)
app.include_router(recordings.router)
