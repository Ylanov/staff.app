"""add tasks table

Revision ID: f1a2c4d8e9b0
Revises: 9cb0a6a9d527
Create Date: 2026-04-17 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2c4d8e9b0'
down_revision: Union[str, Sequence[str], None] = '9cb0a6a9d527'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу tasks для личных календарей пользователей.

    Идемпотентно: CREATE TABLE/INDEX IF NOT EXISTS через raw SQL.
    Защита от сценария когда таблица была создана вручную или предыдущим
    частичным запуском миграции (встречается в prod после аварии).
    """
    op.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id          SERIAL PRIMARY KEY,
            owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title       VARCHAR(300) NOT NULL,
            description TEXT,
            due_date    DATE NOT NULL,
            time_from   VARCHAR(5),
            time_to     VARCHAR(5),
            priority    VARCHAR(20) NOT NULL DEFAULT 'normal',
            status      VARCHAR(20) NOT NULL DEFAULT 'pending',
            category    VARCHAR(100),
            color       VARCHAR(7),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_owner_id  ON tasks (owner_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_due_date  ON tasks (due_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_status    ON tasks (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tasks_owner_due ON tasks (owner_id, due_date)")


def downgrade() -> None:
    op.drop_index('ix_tasks_owner_due', table_name='tasks')
    op.drop_index('ix_tasks_status',    table_name='tasks')
    op.drop_index('ix_tasks_due_date',  table_name='tasks')
    op.drop_index('ix_tasks_owner_id',  table_name='tasks')
    op.drop_table('tasks')
