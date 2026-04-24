"""duty_schedule_approvals + snapshot persons/marks

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-04-23 14:00:00.000000

Зачем:
    Утверждение графика наряда за месяц — это фиксация состояния на момент.
    Пока управление редактирует — месяц в «черновике» (отсутствует запись
    в duty_schedule_approvals). После нажатия «Утвердить» создаётся запись +
    денормализованный snapshot: состав и все отметки за этот месяц
    копируются в отдельные таблицы. Это важно ради стабильности истории
    при последующих увольнениях, переименованиях или правках графика.

    Версии не храним — один snapshot на (schedule, year, month). Повторное
    утверждение после «Редактировать» заменяет старый snapshot.

    Админ видит все snapshot'ы в отдельной вкладке «История графиков».

Структура:
    duty_schedule_approvals
        id, schedule_id, year, month, approved_at, approved_by_user_id
        UNIQUE (schedule_id, year, month)

    duty_schedule_approval_persons
        id, approval_id, person_id (nullable — если после утверждения
        человека физически удалили hard-delete, FK обнуляется),
        full_name, rank, doc_number, order_num

    duty_schedule_approval_marks
        id, approval_id, person_id (nullable, тот же смысл),
        full_name_at_time (дубль для быстрого join-free рендера),
        duty_date, mark_type
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'd6e7f8a9b0c1'
down_revision: Union[str, Sequence[str], None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'duty_schedule_approvals',
        sa.Column('id',         sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('schedule_id', sa.Integer, nullable=False),
        sa.Column('year',       sa.Integer, nullable=False),
        sa.Column('month',      sa.Integer, nullable=False),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('approved_by_user_id', sa.Integer, nullable=True),
        sa.ForeignKeyConstraint(
            ['schedule_id'], ['duty_schedules.id'],
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['approved_by_user_id'], ['users.id'],
            ondelete='SET NULL',
        ),
        sa.UniqueConstraint(
            'schedule_id', 'year', 'month',
            name='uq_duty_approval_schedule_month',
        ),
    )
    op.create_index(
        'ix_duty_approval_schedule',
        'duty_schedule_approvals',
        ['schedule_id', 'year', 'month'],
    )

    op.create_table(
        'duty_schedule_approval_persons',
        sa.Column('id',          sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('approval_id', sa.Integer, nullable=False),
        # Nullable FK: если Person позже hard-deleted — ссылка обнуляется,
        # но full_name/rank/doc_number остаются. История не теряется.
        sa.Column('person_id',   sa.Integer, nullable=True),
        sa.Column('full_name',   sa.String(300), nullable=False),
        sa.Column('rank',        sa.String(100), nullable=True),
        sa.Column('doc_number',  sa.String(100), nullable=True),
        sa.Column('order_num',   sa.Integer, nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(
            ['approval_id'], ['duty_schedule_approvals.id'],
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['person_id'], ['persons.id'],
            ondelete='SET NULL',
        ),
    )
    op.create_index(
        'ix_duty_approval_persons_approval',
        'duty_schedule_approval_persons',
        ['approval_id'],
    )

    op.create_table(
        'duty_schedule_approval_marks',
        sa.Column('id',                sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('approval_id',       sa.Integer, nullable=False),
        sa.Column('person_id',         sa.Integer, nullable=True),
        sa.Column('full_name_at_time', sa.String(300), nullable=False),
        sa.Column('duty_date',         sa.Date,    nullable=False),
        sa.Column('mark_type',         sa.String(2), nullable=False),
        sa.ForeignKeyConstraint(
            ['approval_id'], ['duty_schedule_approvals.id'],
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['person_id'], ['persons.id'],
            ondelete='SET NULL',
        ),
    )
    op.create_index(
        'ix_duty_approval_marks_approval',
        'duty_schedule_approval_marks',
        ['approval_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_duty_approval_marks_approval',    table_name='duty_schedule_approval_marks')
    op.drop_table('duty_schedule_approval_marks')
    op.drop_index('ix_duty_approval_persons_approval',  table_name='duty_schedule_approval_persons')
    op.drop_table('duty_schedule_approval_persons')
    op.drop_index('ix_duty_approval_schedule',          table_name='duty_schedule_approvals')
    op.drop_table('duty_schedule_approvals')
