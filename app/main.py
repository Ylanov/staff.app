# app/main.py

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.core.config import settings
from app.db.database import SessionLocal
from app.api.v1.routers import auth, admin, slots, export, persons, duty   # ← добавлен duty
from app.api.v1.routers import combat_calc
from app.api.v1.routers import settings as settings_router
from app.db.init_db import init_db
from app.core.websockets import manager, handle_websocket_connection


# ─── Lifespan (startup / shutdown) ───────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting application...")

    db = SessionLocal()
    try:
        for attempt in range(10):
            try:
                init_db(db)
                print("✅ Database ready and initial data ensured")
                break

            except OperationalError:
                print(f"⏳ Waiting for database... attempt {attempt + 1}/10")
                await asyncio.sleep(2)

            except ProgrammingError:
                print("⚠️  Tables not found. Run 'alembic upgrade head'")
                break

            except Exception as error:
                print(f"🔥 Unexpected init_db error: {error}")
                break
    finally:
        db.close()

    print("✅ Application started")
    yield
    print("🛑 Application stopped")


# ─── Приложение ───────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
)


# ─── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Роутеры ─────────────────────────────────────────────────────────────────

app.include_router(auth.router,             prefix="/api/v1/auth",     tags=["Авторизация"])
app.include_router(admin.router,            prefix="/api/v1/admin",    tags=["Администрирование"])
app.include_router(slots.router,            prefix="/api/v1/slots",    tags=["Слоты"])
app.include_router(export.router,           prefix="/api/v1/export",   tags=["Экспорт"])
app.include_router(persons.router,          prefix="/api/v1/persons",  tags=["Справочник людей"])
app.include_router(settings_router.router,  prefix="/api/v1/settings", tags=["Настройки"])
app.include_router(duty.router,             prefix="/api/v1/admin",    tags=["Графики наряда"])  # ← НОВОЕ

app.include_router(combat_calc.router,      prefix="/api/v1/admin",    tags=["Боевой расчёт (admin)"])
app.include_router(combat_calc.router,      prefix="/api/v1",          tags=["Боевой расчёт"])


# ─── Статика ──────────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=RedirectResponse, include_in_schema=False)
async def read_root():
    return RedirectResponse(url="/static/index.html")


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await handle_websocket_connection(websocket)