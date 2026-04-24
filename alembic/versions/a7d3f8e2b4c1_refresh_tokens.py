"""refresh_tokens table for real revocation

Revision ID: a7d3f8e2b4c1
Revises: f6a7b8c9d0e1
Create Date: 2026-04-22 10:00:00.000000

Добавляет таблицу refresh_tokens для серверного отзыва refresh-токенов.
Без неё украденный refresh жил бы до истечения (30 дней). Теперь logout
помечает запись revoked_at и /auth/refresh её отклоняет.

Таблица CASCADE-удаляется вместе с юзером (нет смысла хранить токены
удалённого пользователя).

Индекс ix_refresh_expires позволяет периодически зачищать протухшие
записи одним запросом: DELETE FROM refresh_tokens WHERE expires_at < NOW().
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a7d3f8e2b4c1'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id         SERIAL PRIMARY KEY,
            jti        VARCHAR(64) NOT NULL UNIQUE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            issued_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            user_agent VARCHAR(400),
            ip_address INET
        )
    """)
    # jti уже UNIQUE → индекс создан автоматически; добавляем ещё два
    # под конкретные паттерны запросов.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refresh_user_id ON refresh_tokens (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refresh_expires ON refresh_tokens (expires_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_refresh_user_active "
        "ON refresh_tokens (user_id, revoked_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS refresh_tokens")
