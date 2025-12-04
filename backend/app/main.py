from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import create_tables
from app.routers import paperless, correspondents, tags, document_types, settings, llm, debug, statistics, ignored_items


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create database tables
    await create_tables()
    yield
    # Shutdown: cleanup if needed


app = FastAPI(
    title="AI Paperless Organizer",
    description="Intelligente Bereinigung von Korrespondenten, Tags und Dokumententypen in Paperless-ngx",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(paperless.router, prefix="/api/paperless", tags=["Paperless"])
app.include_router(correspondents.router, prefix="/api/correspondents", tags=["Correspondents"])
app.include_router(tags.router, prefix="/api/tags", tags=["Tags"])
app.include_router(document_types.router, prefix="/api/document-types", tags=["Document Types"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(llm.router, prefix="/api/llm", tags=["LLM"])
app.include_router(debug.router, prefix="/api/debug", tags=["Debug"])
app.include_router(statistics.router, prefix="/api/statistics", tags=["Statistics"])
app.include_router(ignored_items.router, prefix="/api/ignored-items", tags=["Ignored Items"])


@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "AI Paperless Organizer"}

