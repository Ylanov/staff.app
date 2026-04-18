"""add users.permissions JSONB column

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-18 14:00:00.000000

Что делает:
    Добавляет колонку users.permissions (JSONB, NOT NULL, default='[все вкладки]').

Зачем:
    Админ хочет гибко настраивать какие вкладки у нового пользователя.
    Вместо жёсткой роли "department" со всеми правами — список разрешений.
    Например, одно управление может видеть только "Списки", другое —
    "Списки + Календарь + База людей".

    Admin (role='admin') всегда видит всё; его permissions игнорируются
    как в backend, так и в UI.

    Список вкладок-ключей: lists, duty, combat, tasks, persons.
    Любая новая вкладка расширяет AVAILABLE_PERMISSIONS в app.models.user
    и добавляется в default здесь через следующую миграцию.

Совместимость:
    server_default гарантирует что все существующие пользователи
    получают полный набор permissions — старая семантика сохраняется.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS через raw SQL — идемпотентно для повторного запуска
    op.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS permissions JSONB
        NOT NULL DEFAULT '["lists","duty","combat","tasks","persons"]'::jsonb
    """)

    # Existing users получают дефолт автоматически через server_default,
    # но на всякий случай заполним NULL'ы (если кто-то запускал ADD COLUMN
    # без default и потом повторяет миграцию).
    op.execute("""
        UPDATE users
        SET permissions = '["lists","duty","combat","tasks","persons"]'::jsonb
        WHERE permissions IS NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS permissions")
