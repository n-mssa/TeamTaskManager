from os import getenv

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .database import Base, engine
from .migrations import apply_migrations
from .routers import auth, delay_reasons, departments, reports, tasks, users
from .services.storage import check_storage, storage_config_status

load_dotenv()

app = FastAPI(title="Team Tasks Manager", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)

origins = [origin.strip() for origin in getenv("CORS_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5174",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def create_tables():
    Base.metadata.create_all(bind=engine)
    apply_migrations()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/storage")
def storage_health():
    return check_storage()


@app.get("/health/storage-config")
def storage_config_health():
    return storage_config_status()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(departments.router)
app.include_router(tasks.router)
app.include_router(delay_reasons.router)
app.include_router(reports.router)
