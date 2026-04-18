"""events.source_template_id — ссылка на шаблон-источник

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-18 20:00:00.000000

Добавляет колонку events.source_template_id — на какой шаблон (Event с
is_template=true) был сгенерирован этот рабочий список. NULL для шаблонов
и для ручных списков.

Зачем:
    Раньше при генерации списков из шаблона через /events/{id}/instantiate
    на одну и ту же дату можно было создать несколько дубликатов одного
    шаблона (повторные нажатия «Сгенерировать»). Запрос в БД не мог
    отличить «новый список» от «уже есть такой».

    С этой колонкой endpoint проверяет:
      SELECT 1 FROM events
      WHERE source_template_id = :tpl_id
        AND date = :target_date
    — и пропускает уже сгенерированные, возвращая их в поле skipped_dates.

    Также колонка помогает на стороне UI показать «уже сгенерирован»
    индикатор для дней в расписании.

Backfill:
    Существующие не-template events пробуем сопоставить по префиксу title
    с шаблонами, чтобы старые данные тоже получили связь. Это best-effort:
    если не удалось — source_template_id остаётся NULL, поведение не ломается.

FK ON DELETE SET NULL:
    Если админ удалит сам шаблон, сгенерированные события сохранятся
    без связи (orphan) — данные не теряем.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE events
        ADD COLUMN IF NOT EXISTS source_template_id INTEGER
        REFERENCES events(id) ON DELETE SET NULL
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_source_template "
        "ON events (source_template_id)"
    )

    # Best-effort backfill: сгенерированный title содержит "{шаблон} (ДД.ММ.ГГГГ, Дн)"
    # поэтому ищем префикс до первой открывающей скобки. Пропускаем
    # случаи когда шаблон с таким именем не нашёлся.
    op.execute("""
        UPDATE events e SET source_template_id = t.id
        FROM   events t
        WHERE  e.is_template = false
          AND  t.is_template = true
          AND  e.source_template_id IS NULL
          AND  e.title LIKE t.title || ' (%'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_events_source_template")
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS source_template_id")
