"""add is_template to events

Revision ID: d42406c4c5d6
Revises: 860cf646432c
Create Date: 2026-04-01 07:22:57.526262
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd42406c4c5d6'
down_revision: Union[str, Sequence[str], None] = '860cf646432c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # 1. Заполняем NULL значения (важно!)
    op.execute(
        "UPDATE events SET is_template = FALSE WHERE is_template IS NULL"
    )

    # 2. Делаем колонку NOT NULL
    op.alter_column(
        'events',
        'is_template',
        existing_type=sa.BOOLEAN(),
        nullable=False
    )

    # 3. Удаляем индекс (если он больше не нужен)
    op.drop_index(op.f('ix_events_is_template'), table_name='events')


def downgrade() -> None:
    """Downgrade schema."""

    # Возвращаем индекс
    op.create_index(
        op.f('ix_events_is_template'),
        'events',
        ['is_template'],
        unique=False
    )

    # Разрешаем NULL обратно
    op.alter_column(
        'events',
        'is_template',
        existing_type=sa.BOOLEAN(),
        nullable=True
    )