"""normalize persons.department: '' -> NULL

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-18 13:00:00.000000

Зачем:
    До этой миграции часть записей (обычно от старых Excel-импортов)
    лежала с persons.department = '' (пустая строка).
    Фильтры API трактуют NULL как "общая запись, видна всем управлениям"
    (OR department IS NULL), а '' — как конкретный department, который
    ни одному username не соответствует. В итоге 700+ записей "проваливались":
    видны только admin'у, недоступны department-пользователям.

    Миграция однократно нормализует данные: UPDATE persons SET department = NULL
    WHERE department = '' OR трим-пустая. Новый код (см. upsert_person_from_slot
    и _clean в импорте) уже кладёт NULL вместо '', поэтому повторного перекоса
    не будет.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Тримим, чтобы " " и "\t" тоже попали
    op.execute(
        "UPDATE persons "
        "SET department = NULL "
        "WHERE department IS NOT NULL AND TRIM(department) = ''"
    )


def downgrade() -> None:
    # Откат нетривиален — мы не знаем какие записи были '' а какие изначально NULL.
    # Для downgrade-сценария откат данных не делаем (только структуру).
    pass
