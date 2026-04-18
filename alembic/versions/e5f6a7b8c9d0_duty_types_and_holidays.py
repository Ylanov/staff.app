"""duty_marks.mark_type + holidays table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-18 17:00:00.000000

Три изменения:

1. duty_marks.mark_type (VARCHAR(2), NOT NULL, default 'N').
   Тип отметки в графике наряда:
     'N' — Наряд (обычное дежурство, было по умолчанию)
     'U' — Увольнение
     'V' — Отпуск (Vacation — один день отпуска)
   Существующие записи получают 'N' через server_default.

2. Уникальный constraint duty_marks(schedule_id, person_id, duty_date)
   остаётся (один человек не может быть отмечен дважды в один день).
   Но теперь в составе ключа НЕТ mark_type — т.е. если человек уже был
   отмечен 'N' в день, поставить ему 'V' в тот же день не получится
   без предварительного снятия 'N'. Это правильно: один человек = один
   тип отметки в день (иначе неоднозначность в табеле).

3. Новая таблица holidays:
     date (PK), title, is_last_day.
   Правила подсчёта переработки (client-side):
     Пн-Чт  → +4 ч
     Пт     → +12 ч
     Сб     → +20 ч
     Вс     → +12 ч
     Праздник (is_last_day=false) → +20 ч
     Праздник (is_last_day=true)  → +12 ч   (последний день каникул)
     День перед праздником        → +12 ч   (вычисляется на клиенте)
   Админ может управлять списком через /api/v1/admin/holidays.

   Seed: основные праздники РФ 2026 вставляются в этой миграции для
   удобства первого запуска.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── duty_marks.mark_type ─────────────────────────────────────────────────
    op.execute("""
        ALTER TABLE duty_marks
        ADD COLUMN IF NOT EXISTS mark_type VARCHAR(2) NOT NULL DEFAULT 'N'
    """)
    # Индекс на mark_type — фильтры "только наряды" / "только отпуска"
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_duty_marks_mark_type "
        "ON duty_marks (mark_type)"
    )

    # ── holidays ─────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS holidays (
            date         DATE         PRIMARY KEY,
            title        VARCHAR(200) NOT NULL,
            is_last_day  BOOLEAN      NOT NULL DEFAULT false,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ── Seed: российские праздники 2026 ──────────────────────────────────────
    # is_last_day = true для последнего дня каникулярных блоков.
    # Идемпотентно: ON CONFLICT DO NOTHING — повторный запуск не перетирает
    # то что уже поправил админ руками.
    op.execute("""
        INSERT INTO holidays (date, title, is_last_day) VALUES
            ('2026-01-01', 'Новогодние каникулы',         false),
            ('2026-01-02', 'Новогодние каникулы',         false),
            ('2026-01-03', 'Новогодние каникулы',         false),
            ('2026-01-04', 'Новогодние каникулы',         false),
            ('2026-01-05', 'Новогодние каникулы',         false),
            ('2026-01-06', 'Новогодние каникулы',         false),
            ('2026-01-07', 'Рождество Христово',          false),
            ('2026-01-08', 'Новогодние каникулы (посл.)', true),
            ('2026-02-23', 'День защитника Отечества',    true),
            ('2026-03-07', 'Перенос (Межд. женский день)',false),
            ('2026-03-08', 'Международный женский день',  false),
            ('2026-03-09', 'Межд. женский день (посл.)',  true),
            ('2026-05-01', 'Праздник Весны и Труда',      false),
            ('2026-05-02', 'Праздник Весны и Труда',      false),
            ('2026-05-03', 'Праздник Весны и Труда (посл.)', true),
            ('2026-05-09', 'День Победы',                 false),
            ('2026-05-10', 'День Победы (посл.)',         true),
            ('2026-06-12', 'День России',                 false),
            ('2026-06-13', 'День России (посл.)',         true),
            ('2026-06-14', 'День России (посл.)',         true),
            ('2026-11-04', 'День народного единства',     true)
        ON CONFLICT (date) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS holidays")
    op.execute("DROP INDEX IF EXISTS ix_duty_marks_mark_type")
    op.execute("ALTER TABLE duty_marks DROP COLUMN IF EXISTS mark_type")
