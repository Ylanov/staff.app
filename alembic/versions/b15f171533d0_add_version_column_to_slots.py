"""add_version_column_to_slots

Revision ID: b15f171533d0
Revises: d57caa78b5e6
Create Date: 2026-04-01 14:35:28.150338

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b15f171533d0'
down_revision: Union[str, Sequence[str], None] = 'd57caa78b5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # 1. Добавляем колонку с дефолтом, чтобы не упасть на существующих строках
    op.add_column(
        'slots',
        sa.Column(
            'version',
            sa.Integer(),
            nullable=False,
            server_default='1'
        )
    )

    # 2. Убираем server_default (чтобы дальше использовался default на уровне ORM)
    op.alter_column(
        'slots',
        'version',
        server_default=None
    )


def downgrade() -> None:
    """Downgrade schema."""

    # Удаляем колонку
    op.drop_column('slots', 'version')