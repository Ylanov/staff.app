# app/main.py

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import ProgrammingError, OperationalError
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.limiter import limiter
from app.db.database import SessionLocal
from app.api.v1.routers import auth, admin, slots, export, persons, duty
from app.api.v1.routers import combat_calc
from app.api.v1.routers import settings as settings_router
from app.api.v1.routers import dept_duty
from app.api.v1.routers import dashboard
from app.api.v1.routers import tasks
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


# ─── Rate limiting ────────────────────────────────────────────────────────────
# Глобальный лимитер (per-IP). Используется через app.state.limiter,
# чтобы SlowAPIMiddleware и декораторы @limiter.limit(...) в роутерах
# могли обращаться к одному инстансу.
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    # 429 Too Many Requests — стандартный ответ по RFC 6585.
    # detail с понятной формулировкой, Retry-After добавляет SlowAPI.
    return JSONResponse(
        status_code=429,
        content={"detail": f"Слишком много запросов. Повторите позже ({exc.detail})."},
    )


app.add_middleware(SlowAPIMiddleware)


# ─── CORS ─────────────────────────────────────────────────────────────────────
# ИСПРАВЛЕНО: раньше allow_methods/allow_headers=["*"] — слишком широко.
# Теперь явный список методов которые реально используются API.
# allow_headers включает Authorization (JWT), Content-Type, и всё что
# фронт реально шлёт. Это снижает поверхность атаки через CORS-preflight.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept"],
)


# ─── Роутеры ─────────────────────────────────────────────────────────────────

app.include_router(auth.router,            prefix="/api/v1/auth",    tags=["Авторизация"])
app.include_router(admin.router,           prefix="/api/v1/admin",   tags=["Администрирование"])
app.include_router(slots.router,           prefix="/api/v1/slots",   tags=["Слоты"])
app.include_router(export.router,          prefix="/api/v1/export",  tags=["Экспорт"])
app.include_router(persons.router,         prefix="/api/v1/persons", tags=["Справочник людей"])
app.include_router(settings_router.router, prefix="/api/v1/settings",tags=["Настройки"])
app.include_router(duty.router,            prefix="/api/v1/admin",   tags=["Графики наряда"])
app.include_router(dashboard.router,       prefix="/api/v1/admin",   tags=["Дашборд"])
app.include_router(dept_duty.router,       prefix="/api/v1/dept",    tags=["Графики наряда (управление)"])
app.include_router(tasks.router,           prefix="/api/v1/tasks",   tags=["Календарь задач"])

# ─── Боевой расчёт ────────────────────────────────────────────────────────────
# ИСПРАВЛЕНО: раньше один и тот же роутер подключался дважды с разными prefix,
# что дублировало все маршруты. Теперь:
#   - /api/v1/admin/combat/...  — маршруты только для администратора
#   - /api/v1/combat/...        — маршруты для управлений (заполнение)
# Оба набора маршрутов находятся в одном файле combat_calc.py и разделены
# зависимостями get_current_active_admin / get_current_user внутри роутера.
# Подключаем ОДИН РАЗ с prefix /api/v1, маршруты внутри уже имеют /admin/combat/...
# и /combat/... — FastAPI сам строит полный путь.
app.include_router(combat_calc.admin_router, prefix="/api/v1/admin", tags=["Боевой расчёт (admin)"])
app.include_router(combat_calc.dept_router,  prefix="/api/v1",       tags=["Боевой расчёт (управление)"])


# ─── Статика ──────────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=RedirectResponse, include_in_schema=False)
async def read_root():
    return RedirectResponse(url="/static/index.html")


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await handle_websocket_connection(websocket)