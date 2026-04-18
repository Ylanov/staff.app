"""merge heads + fio matching + perf indexes

Revision ID: a1b2c3d4e5f6
Revises: 470fe629068a, f1a2c4d8e9b0
Create Date: 2026-04-18 00:00:00.000000

Одна миграция решает три задачи:

1. МЕРЖ веток Alembic.
   После 9cb0a6a9d527 образовалось две головы:
     - 470fe629068a (new_6)
     - f1a2c4d8e9b0 (add_tasks_table)
   alembic upgrade head ломается при двух head'ах. Эта ревизия — merge point.

2. PG_TRGM для подбора ФИО.
   Включает расширение pg_trgm (trigram similarity) и создаёт GIN-индекс
   на lower(persons.full_name) — нужно для endpoint /persons/suggest
   который делает fuzzy-поиск с оценкой схожести.

3. ИНДЕКСЫ производительности для 2к пользователей.
   Составной индекс (status, is_template) на events — дашборд часто
   фильтрует "активные не-шаблоны". Частичный индекс на duty_marks по
   duty_date — админ-раздел запрашивает наряд на дату.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = ('470fe629068a', 'f1a2c4d8e9b0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── pg_trgm для fuzzy-поиска ФИО ────────────────────────────────────────
    # IF NOT EXISTS — миграция идемпотентна даже если расширение уже стоит
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # GIN-индекс по lower(full_name) для similarity()/ILIKE — без него
    # при 100k+ записей fuzzy-поиск будет сканировать всю таблицу.
    # IF NOT EXISTS чтобы не падать при повторном запуске.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_persons_full_name_trgm "
        "ON persons USING gin (lower(full_name) gin_trgm_ops)"
    )

    # Композитный индекс (full_name, rank, doc_number) — для точного
    # совпадения при подборе (все три поля совпали → 100% match_score).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_persons_name_rank_doc "
        "ON persons (lower(full_name), rank, doc_number)"
    )

    # ── Индексы производительности ──────────────────────────────────────────
    # Частый фильтр в dashboard/slots: status='active' AND is_template=false
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_status_template "
        "ON events (status, is_template)"
    )

    # Postgres НЕ создаёт индексы на FK автоматически. При росте duty_marks
    # до 100k+ записей JOIN'ы и фильтры начнут деградировать в seq scan.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_marks_duty_date "
        "ON duty_marks (duty_date)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_marks_schedule_id "
        "ON duty_marks (schedule_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_marks_person_id "
        "ON duty_marks (person_id)"
    )
    # Частая комбинация в admin._get_duty_map_for_date: по дате + schedule
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_marks_date_schedule "
        "ON duty_marks (duty_date, schedule_id)"
    )

    # Аналогично для duty_schedule_persons — FK без индексов
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_schedule_persons_schedule "
        "ON duty_schedule_persons (schedule_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_schedule_persons_person "
        "ON duty_schedule_persons (person_id)"
    )

    # persons.department — фильтр в /persons и /persons/search для ролей
    # (не-admin видит только своих + общих). Без индекса — seq scan.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_persons_department "
        "ON persons (department)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_persons_department")
    op.execute("DROP INDEX IF EXISTS ix_duty_schedule_persons_person")
    op.execute("DROP INDEX IF EXISTS ix_duty_schedule_persons_schedule")
    op.execute("DROP INDEX IF EXISTS ix_duty_marks_date_schedule")
    op.execute("DROP INDEX IF EXISTS ix_duty_marks_person_id")
    op.execute("DROP INDEX IF EXISTS ix_duty_marks_schedule_id")
    op.execute("DROP INDEX IF EXISTS ix_duty_marks_duty_date")
    op.execute("DROP INDEX IF EXISTS ix_events_status_template")
    op.execute("DROP INDEX IF EXISTS ix_persons_name_rank_doc")
    op.execute("DROP INDEX IF EXISTS ix_persons_full_name_trgm")
    # pg_trgm НЕ удаляем — другие объекты могут его использовать
