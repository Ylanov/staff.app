"""add persons.fired_at

Revision ID: c5d6e7f8a9b0
Revises: f6a7b8c9d0e1
Create Date: 2026-04-23 12:00:00.000000

Зачем:
    Увольнение человека — мягкое. Поле fired_at хранит момент увольнения
    (NULL = активный). В запросах /persons/suggest, /persons/search и
    GET /persons по умолчанию отдаём только fired_at IS NULL.

    Person сам НЕ удаляется — это нужно чтобы сохранять историю
    (duty_marks, slots с денормализованным ФИО ссылаются на старые данные,
    duty_marks держат FK на person). Из активного состава графиков
    (duty_schedule_persons) уволенный удаляется явно в endpoint /fire.

    Индекс частичный (WHERE fired_at IS NOT NULL) оптимизирует редкий
    кейс «показать уволенных» — размер таблицы обычно ~10k записей,
    уволенных — единицы. Полный индекс не нужен.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'persons',
        sa.Column('fired_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        'ix_persons_fired_at',
        'persons',
        ['fired_at'],
        postgresql_where=sa.text('fired_at IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('ix_persons_fired_at', table_name='persons')
    op.drop_column('persons', 'fired_at')
