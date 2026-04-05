# app/db/init_db.py
"""
ИСПРАВЛЕНИЕ: убран вызов Base.metadata.create_all() из init_db.

Проблема была в том что create_all запускался при старте КАЖДОГО gunicorn-воркера.
При 4 воркерах — 4 параллельных вызова create_all при старте.
Это создавало гонку состояний с Alembic-миграциями:
  - один воркер начинает создавать таблицу
  - другой параллельно читает незавершённую схему
  - возможны ошибки типа "relation does not exist" или duplicate column

Правильный подход:
  Управление схемой БД — исключительно через Alembic.
  init_db теперь только:
    1. Засевает шаблоны боевого расчёта (если их нет)
    2. Создаёт admin-пользователя (если его нет)
    3. Обрабатывает сброс пароля по флагу RESET_ADMIN_PASSWORD

Схема запуска в Docker:
  entrypoint.sh:
    alembic upgrade head   ← меняет схему БД (один раз, один процесс)
    gunicorn app.main:app  ← запускает воркеры (init_db без create_all)
"""

import secrets
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.user import User
from app.core.security import get_password_hash
from app.core.config import settings


def init_db(db: Session) -> None:
    """
    Инициализация данных при старте приложения.

    НЕ управляет схемой БД — это делает Alembic.
    Только засевает начальные данные если их нет.
    """

    # Advisory lock защищает от гонки при запуске нескольких воркеров gunicorn.
    # Только один воркер пройдёт дальше, остальные дождутся его завершения.
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(2023120101)"))
    except Exception:
        pass

    # ─── Засев шаблонов боевого расчёта ──────────────────────────────────────
    # Идемпотентно: создаёт шаблоны только если их нет
    try:
        from app.db.seed_combat_calc import seed_templates
        seed_templates(db)
    except Exception as e:
        print(f"⚠️  seed_templates warning (non-fatal): {e}")

    # ─── Администратор ───────────────────────────────────────────────────────
    admin_user = db.query(User).filter(User.username == "admin").first()

    # Сброс пароля по запросу (флаг RESET_ADMIN_PASSWORD=true в .env)
    if admin_user and settings.RESET_ADMIN_PASSWORD:
        if settings.ADMIN_PASSWORD:
            new_password = settings.ADMIN_PASSWORD
            source = "из переменной окружения ADMIN_PASSWORD"
        else:
            new_password = secrets.token_urlsafe(16)
            source = "сгенерирован автоматически (сохраните!)"

        admin_user.hashed_password = get_password_hash(new_password)
        db.commit()

        print("=" * 60)
        print("🔑  Пароль администратора сброшен!")
        print(f"    Логин:  admin")
        print(f"    Пароль: {new_password}  ({source})")
        print("    Снимите флаг RESET_ADMIN_PASSWORD=false после перезапуска")
        print("=" * 60)
        return

    if admin_user:
        print("ℹ️  Суперпользователь 'admin' уже существует")
        return

    # ─── Первичное создание администратора ───────────────────────────────────
    if settings.ADMIN_PASSWORD:
        password        = settings.ADMIN_PASSWORD
        password_source = "из переменной окружения ADMIN_PASSWORD"
    else:
        password        = secrets.token_urlsafe(16)
        password_source = "сгенерирован автоматически (сохраните его!)"

    new_admin = User(
        username="admin",
        hashed_password=get_password_hash(password),
        role="admin",
        is_active=True,
    )
    db.add(new_admin)
    db.commit()

    print("=" * 60)
    print("✅  Суперпользователь 'admin' создан!")
    print(f"    Логин:  admin")
    print(f"    Пароль: {password}  ({password_source})")
    print("=" * 60)