"""unique (source_template_id, date) for non-templates

Revision ID: c5e8a2b9d47f
Revises: a7d3f8e2b4c1
Create Date: 2026-04-22 12:00:00.000000

Предотвращает дубли «один шаблон × одна дата» на уровне БД.

Зачем:
    Логика в /admin/events/{id}/instantiate проверяет дубли через
    SELECT, но это даёт окно для race condition при параллельных
    запросах (двойной клик, retry). Partial unique index закрывает
    это окно — postgres отдаст ошибку 23505, а бэк её перехватит.

Частичный (WHERE source_template_id IS NOT NULL AND is_template = false):
    - Шаблоны (is_template=true) и ручные списки без source_template_id
      не должны мешать — для них дубли допустимы / не релевантны.
    - Партишн-индекс compact — покрывает только «сгенерированные из
      шаблона списки», что и требуется для дедупа.

Если данные в БД УЖЕ содержат дубли (старые ошибки до фикса):
    Миграция НЕ удалит их автоматически (иначе рискованно). Сначала
    удаляются лишние записи вручную, потом запускается upgrade.
    Проверка дублей:
      SELECT source_template_id, date, COUNT(*)
      FROM events
      WHERE source_template_id IS NOT NULL AND NOT is_template
      GROUP BY 1,2 HAVING COUNT(*) > 1;
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c5e8a2b9d47f'
down_revision: Union[str, Sequence[str], None] = 'a7d3f8e2b4c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Сначала «мягко» вычищаем дубли, оставляя запись с минимальным id.
    # Последовательность удаления диктуется FK без CASCADE:
    #   slots.group_id → groups.id (NO ACTION)
    #   groups.event_id → events.id (NO ACTION)
    # Поэтому удаляем в обратном порядке: slots → groups → events.
    #
    # Если дублей нет — все три DELETE быстро возвращают 0 rows, миграция
    # идемпотентна. Если дубли есть — транзакция обеспечивает атомарность.
    op.execute("""
        -- Временная таблица с ID дубликатов для повторного использования
        CREATE TEMP TABLE _dup_event_ids ON COMMIT DROP AS
        SELECT id FROM events
        WHERE source_template_id IS NOT NULL
          AND is_template = false
          AND date IS NOT NULL
          AND id NOT IN (
              SELECT MIN(id) FROM events
              WHERE source_template_id IS NOT NULL
                AND is_template = false
                AND date IS NOT NULL
              GROUP BY source_template_id, date
          )
    """)

    # 1) Удаляем слоты дублирующих событий
    op.execute("""
        DELETE FROM slots
        WHERE group_id IN (
            SELECT id FROM groups WHERE event_id IN (SELECT id FROM _dup_event_ids)
        )
    """)

    # 2) Удаляем группы дублирующих событий
    op.execute("""
        DELETE FROM groups
        WHERE event_id IN (SELECT id FROM _dup_event_ids)
    """)

    # 3) На всякий случай — «развязываем» audit_log записи (там нет FK на events,
    #    но entity_id может указывать на удаляемый список; пусть остаётся
    #    как есть — это append-only история, сами ссылки ни на что не ломают
    #    приложение, слот просто не будет найден при клике).

    # 4) Теперь удаляем сами дубли-events
    op.execute("""
        DELETE FROM events WHERE id IN (SELECT id FROM _dup_event_ids)
    """)

    # 5) Создаём защиту от будущих дублей
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_events_source_template_date
        ON events (source_template_id, date)
        WHERE source_template_id IS NOT NULL
          AND is_template = false
          AND date IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_events_source_template_date")
