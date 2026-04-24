"""merge approvals (d6e7f8a9b0c1) and refresh_tokens/events_unique (c5e8a2b9d47f)

Revision ID: e7f8a9b0c1d2
Revises: c5e8a2b9d47f, d6e7f8a9b0c1
Create Date: 2026-04-23 19:20:00.000000

Merge-миграция.

Контекст:
    Две параллельные ветки развивались от общего предка f6a7b8c9d0e1:

    • Ветка «auth/refresh»:
          f6a7b8c9d0e1
            → a7d3f8e2b4c1  (refresh_tokens table)
            → c5e8a2b9d47f  (events unique index)

    • Ветка «persons/approvals» (текущая):
          f6a7b8c9d0e1
            → c5d6e7f8a9b0  (persons.fired_at — мягкое увольнение)
            → d6e7f8a9b0c1  (duty_schedule_approvals + snapshot tables)

    Эта миграция ничего не делает в схеме — она только объединяет два
    head'а в один, чтобы `alembic upgrade head` перестал падать с
    "Multiple head revisions".
"""
from typing import Sequence, Union


revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, Sequence[str], None] = ('c5e8a2b9d47f', 'd6e7f8a9b0c1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
