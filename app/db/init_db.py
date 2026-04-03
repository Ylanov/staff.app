# app/db/init_db.py

import secrets
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.user import User
from app.core.security import get_password_hash
from app.core.config import settings


def init_db(db: Session) -> None:
    # Advisory lock защищает от гонки при запуске нескольких воркеров gunicorn.
    # Блокировка снимается автоматически по окончании транзакции.
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(2023120101)"))
    except Exception:
        # SQLite в тестах не поддерживает advisory locks — пропускаем
        pass

    admin_user = db.query(User).filter(User.username == "admin").first()

    # ─── Сброс пароля по запросу ─────────────────────────────────────────────
    if admin_user and settings.RESET_ADMIN_PASSWORD:
        # RESET_ADMIN_PASSWORD=true в .env + ADMIN_PASSWORD=новый_пароль
        # позволяет сбросить пароль без удаления аккаунта и без потери данных.
        # После сброса снимите флаг RESET_ADMIN_PASSWORD=false чтобы не сбрасывать
        # пароль при каждом перезапуске приложения.
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
        password = settings.ADMIN_PASSWORD
        password_source = "из переменной окружения ADMIN_PASSWORD"
    else:
        password = secrets.token_urlsafe(16)
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