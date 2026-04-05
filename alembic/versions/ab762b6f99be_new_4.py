"""new-4

Revision ID: ab762b6f99be
Revises: e87de53f62c3
Create Date: 2026-04-04 17:04:19.348162

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'ab762b6f99be'
down_revision: Union[str, Sequence[str], None] = 'e87de53f62c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'persons',
        sa.Column('position_title', sa.String(200), nullable=True),
    )
    op.add_column(
        'persons',
        sa.Column('birth_date', sa.Date(), nullable=True),
    )
    op.add_column(
        'persons',
        sa.Column('phone', sa.String(50), nullable=True),
    )
    op.add_column(
        'persons',
        sa.Column('notes', sa.Text(), nullable=True),
    )
    # Увеличиваем размер full_name до 300 символов (было String без размера)
    op.alter_column(
        'persons', 'full_name',
        type_=sa.String(300),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.drop_column('persons', 'notes')
    op.drop_column('persons', 'phone')
    op.drop_column('persons', 'birth_date')
    op.drop_column('persons', 'position_title')
    # ### end Alembic commands ###
