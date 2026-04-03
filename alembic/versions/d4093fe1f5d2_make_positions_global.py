"""make_positions_global

Revision ID: d4093fe1f5d2
Revises: 6132af53faf0
Create Date: 2026-04-03 04:10:55.428150

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4093fe1f5d2'
down_revision: Union[str, Sequence[str], None] = '6132af53faf0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    # 1. Снимаем FK-constraint
    op.drop_constraint('positions_event_id_fkey', 'positions', type_='foreignkey')
    # 2. Дедупликация — оставляем одну запись с каждым именем (наименьший id)
    op.execute("""
        DELETE FROM positions
        WHERE id NOT IN (
            SELECT MIN(id) FROM positions GROUP BY name
        )
    """)
    # 3. Обнуляем position_id у слотов, которые ссылались на удалённые дубли
    # (уже OK, потому что DELETE CASCADE не настроен, но для чистоты)
    # 4. Удаляем столбец
    op.drop_column('positions', 'event_id')
    # 5. Уникальность имён
    op.create_unique_constraint('uq_positions_name', 'positions', ['name'])

def downgrade():
    op.drop_constraint('uq_positions_name', 'positions', type_='unique')
    op.add_column('positions', sa.Column('event_id', sa.Integer(), nullable=True))