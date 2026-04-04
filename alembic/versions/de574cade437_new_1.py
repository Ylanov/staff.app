"""new-1

Revision ID: de574cade437
Revises: 79740d2ea749
Create Date: 2026-04-03 12:04:15.605357

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de574cade437'
down_revision: Union[str, Sequence[str], None] = '79740d2ea749'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # duty_schedules
    op.create_table(
        'duty_schedules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('position_id', sa.Integer(), nullable=True),
        sa.Column('position_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['position_id'], ['positions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_duty_schedules_id', 'duty_schedules', ['id'], unique=False)

    # duty_schedule_persons
    op.create_table(
        'duty_schedule_persons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('schedule_id', sa.Integer(), nullable=False),
        sa.Column('person_id', sa.Integer(), nullable=False),
        sa.Column('order_num', sa.Integer(), nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['schedule_id'], ['duty_schedules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['person_id'], ['persons.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('schedule_id', 'person_id', name='uq_duty_schedule_person'),
    )

    # duty_marks
    op.create_table(
        'duty_marks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('schedule_id', sa.Integer(), nullable=False),
        sa.Column('person_id', sa.Integer(), nullable=False),
        sa.Column('duty_date', sa.Date(), nullable=False),
        sa.ForeignKeyConstraint(['schedule_id'], ['duty_schedules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['person_id'], ['persons.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('schedule_id', 'person_id', 'duty_date', name='uq_duty_mark'),
    )


def downgrade() -> None:
    op.drop_table('duty_marks')
    op.drop_table('duty_schedule_persons')
    op.drop_index('ix_duty_schedules_id', table_name='duty_schedules')
    op.drop_table('duty_schedules')
