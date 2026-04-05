"""new-5

Revision ID: 9cb0a6a9d527
Revises: ab762b6f99be
Create Date: 2026-04-04 17:51:22.712889

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9cb0a6a9d527'
down_revision: Union[str, Sequence[str], None] = 'ab762b6f99be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── events ────────────────────────────────────────────────────────────────
    op.create_index(
        "ix_events_date",
        "events", ["date"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_events_status",
        "events", ["status"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_events_is_template",
        "events", ["is_template"],
        if_not_exists=True,
    )
    # Составной индекс — самый важный для dashboard/duty запросов
    op.create_index(
        "ix_events_date_template",
        "events", ["date", "is_template"],
        if_not_exists=True,
    )

    # ── groups ────────────────────────────────────────────────────────────────
    op.create_index(
        "ix_groups_event_id",
        "groups", ["event_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_groups_order_num",
        "groups", ["order_num"],
        if_not_exists=True,
    )

    # ── slots ─────────────────────────────────────────────────────────────────
    op.create_index(
        "ix_slots_group_id",
        "slots", ["group_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_slots_position_id",
        "slots", ["position_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_slots_department",
        "slots", ["department"],
        if_not_exists=True,
    )

    # ── combat_calc_instances ─────────────────────────────────────────────────
    op.create_index(
        "ix_combat_calc_instances_template_id",
        "combat_calc_instances", ["template_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_combat_calc_instances_calc_date",
        "combat_calc_instances", ["calc_date"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_combat_calc_instances_date_status",
        "combat_calc_instances", ["calc_date", "status"],
        if_not_exists=True,
    )

    # ── combat_calc_slots ─────────────────────────────────────────────────────
    op.create_index(
        "ix_combat_calc_slots_instance_id",
        "combat_calc_slots", ["instance_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_combat_calc_slots_row_key",
        "combat_calc_slots", ["row_key"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_combat_calc_slots_instance_row",
        "combat_calc_slots", ["instance_id", "row_key"],
        if_not_exists=True,
    )


def downgrade() -> None:
    # combat_calc_slots
    op.drop_index("ix_combat_calc_slots_instance_row", table_name="combat_calc_slots")
    op.drop_index("ix_combat_calc_slots_row_key", table_name="combat_calc_slots")
    op.drop_index("ix_combat_calc_slots_instance_id", table_name="combat_calc_slots")

    # combat_calc_instances
    op.drop_index("ix_combat_calc_instances_date_status", table_name="combat_calc_instances")
    op.drop_index("ix_combat_calc_instances_calc_date", table_name="combat_calc_instances")
    op.drop_index("ix_combat_calc_instances_template_id", table_name="combat_calc_instances")

    # slots
    op.drop_index("ix_slots_department", table_name="slots")
    op.drop_index("ix_slots_position_id", table_name="slots")
    op.drop_index("ix_slots_group_id", table_name="slots")

    # groups
    op.drop_index("ix_groups_order_num", table_name="groups")
    op.drop_index("ix_groups_event_id", table_name="groups")

    # events
    op.drop_index("ix_events_date_template", table_name="events")
    op.drop_index("ix_events_is_template", table_name="events")
    op.drop_index("ix_events_status", table_name="events")
    op.drop_index("ix_events_date", table_name="events")