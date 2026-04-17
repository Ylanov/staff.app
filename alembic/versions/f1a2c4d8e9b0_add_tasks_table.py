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
    """Создаёт таблицу tasks для личных календарей пользователей."""
    op.create_table(
        'tasks',
        sa.Column('id',          sa.Integer(),      primary_key=True),
        sa.Column('owner_id',    sa.Integer(),      nullable=False),
        sa.Column('title',       sa.String(300),    nullable=False),
        sa.Column('description', sa.Text(),         nullable=True),
        sa.Column('due_date',    sa.Date(),         nullable=False),
        sa.Column('time_from',   sa.String(5),      nullable=True),
        sa.Column('time_to',     sa.String(5),      nullable=True),
        sa.Column('priority',    sa.String(20),     nullable=False, server_default='normal'),
        sa.Column('status',      sa.String(20),     nullable=False, server_default='pending'),
        sa.Column('category',    sa.String(100),    nullable=True),
        sa.Column('color',       sa.String(7),      nullable=True),
        sa.Column('created_at',  sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at',  sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    )
    op.create_index('ix_tasks_owner_id', 'tasks', ['owner_id'])
    op.create_index('ix_tasks_due_date', 'tasks', ['due_date'])
    op.create_index('ix_tasks_status',   'tasks', ['status'])
    op.create_index('ix_tasks_owner_due', 'tasks', ['owner_id', 'due_date'])


def downgrade() -> None:
    op.drop_index('ix_tasks_owner_due', table_name='tasks')
    op.drop_index('ix_tasks_status',    table_name='tasks')
    op.drop_index('ix_tasks_due_date',  table_name='tasks')
    op.drop_index('ix_tasks_owner_id',  table_name='tasks')
    op.drop_table('tasks')
