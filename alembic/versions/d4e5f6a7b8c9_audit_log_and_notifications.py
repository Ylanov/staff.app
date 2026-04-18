"""audit_log + notifications tables

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-18 15:00:00.000000

Добавляет две таблицы:
  audit_log     — append-only журнал изменений (кто/что/когда/откуда);
  notifications — персональная лента уведомлений с is_read.

Обе таблицы связаны с users.id:
  audit_log     — SET NULL при удалении юзера (история сохраняется);
  notifications — CASCADE (неактуально хранить уведомления удалённого).

INET — нативный PG-тип для IP-адресов, экономит место против VARCHAR
и валидирует формат на уровне БД.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── audit_log ────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id          SERIAL PRIMARY KEY,
            timestamp   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
            username    VARCHAR(100),
            action      VARCHAR(50)  NOT NULL,
            entity_type VARCHAR(50)  NOT NULL,
            entity_id   INTEGER,
            old_values  JSONB,
            new_values  JSONB,
            ip_address  INET,
            user_agent  VARCHAR(400),
            extra       JSONB
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_timestamp   ON audit_log (timestamp)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_user_id     ON audit_log (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_action      ON audit_log (action)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_entity_type ON audit_log (entity_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_log_entity_id   ON audit_log (entity_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_entity_ts "
               "ON audit_log (entity_type, entity_id, timestamp)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_user_ts "
               "ON audit_log (user_id, timestamp)")

    # ── notifications ────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind       VARCHAR(50)  NOT NULL,
            title      VARCHAR(200) NOT NULL,
            body       TEXT,
            link       VARCHAR(500),
            audit_id   INTEGER REFERENCES audit_log(id) ON DELETE SET NULL,
            is_read    INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            read_at    TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_user_id    ON notifications (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_kind       ON notifications (kind)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_is_read    ON notifications (is_read)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_user_read_ts "
               "ON notifications (user_id, is_read, created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notifications")
    op.execute("DROP TABLE IF EXISTS audit_log")
