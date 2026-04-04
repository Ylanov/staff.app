# app/models/duty.py
"""
Модели для системы графиков наряда.

DutySchedule        — сам график (название + привязка к должности)
DutySchedulePerson  — люди, включённые в этот график
DutyMark            — отметка «в наряде» (человек × дата)

Связи:
  DutySchedule.position  → Position   (ManyToOne, ondelete=SET NULL)
  DutySchedule.persons   → DutySchedulePerson[]  (OneToMany, cascade delete)
  DutySchedule.marks     → DutyMark[]            (OneToMany, cascade delete)
  DutySchedulePerson.person → Person  (ManyToOne, ondelete=CASCADE)
  DutyMark.person           → Person  (ManyToOne, ondelete=CASCADE)
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, String, Date, ForeignKey,
    DateTime, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.database import Base


class DutySchedule(Base):
    """График наряда — один на должность (или без привязки к должности)."""

    __tablename__ = "duty_schedules"

    id            = Column(Integer, primary_key=True, index=True)
    title         = Column(String,  nullable=False)
    # Внешний ключ на таблицу positions; при удалении должности — ставим NULL,
    # чтобы не потерять сам график.
    position_id   = Column(
        Integer,
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Кэшированное имя должности — сохраняется на момент создания/изменения
    # и используется как fallback если должность была удалена.
    position_name = Column(String, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Relationships ─────────────────────────────────────────────────────────
    position = relationship(
        "Position",
        foreign_keys=[position_id],
        lazy="joined",
    )
    persons = relationship(
        "DutySchedulePerson",
        back_populates="schedule",
        cascade="all, delete-orphan",
        order_by="DutySchedulePerson.order_num, DutySchedulePerson.id",
        lazy="selectin",
    )
    marks = relationship(
        "DutyMark",
        back_populates="schedule",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )


class DutySchedulePerson(Base):
    """
    Человек, включённый в конкретный график наряда.

    Уникальный constraint: (schedule_id, person_id) — один человек не может
    быть добавлен в один и тот же график дважды.
    """

    __tablename__ = "duty_schedule_persons"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    schedule_id = Column(
        Integer,
        ForeignKey("duty_schedules.id", ondelete="CASCADE"),
        nullable=False,
    )
    person_id   = Column(
        Integer,
        ForeignKey("persons.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Порядок отображения в сетке (0-based, возрастает при добавлении)
    order_num   = Column(Integer, default=0, nullable=False)

    # ── Relationships ─────────────────────────────────────────────────────────
    schedule = relationship("DutySchedule", back_populates="persons")
    person   = relationship("Person", lazy="joined")

    __table_args__ = (
        UniqueConstraint(
            "schedule_id", "person_id",
            name="uq_duty_schedule_person",
        ),
    )


class DutyMark(Base):
    """
    Отметка «человек заступил в наряд в конкретный день».

    Уникальный constraint: (schedule_id, person_id, duty_date) —
    один человек не может быть отмечен дважды в один день в рамках одного графика.

    При создании отметки бэкенд автоматически заполняет слоты во всех
    списках (events) за эту дату, где должность совпадает с schedule.position_id.
    """

    __tablename__ = "duty_marks"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    schedule_id = Column(
        Integer,
        ForeignKey("duty_schedules.id", ondelete="CASCADE"),
        nullable=False,
    )
    person_id   = Column(
        Integer,
        ForeignKey("persons.id", ondelete="CASCADE"),
        nullable=False,
    )
    duty_date   = Column(Date, nullable=False)

    # ── Relationships ─────────────────────────────────────────────────────────
    schedule = relationship("DutySchedule", back_populates="marks")
    person   = relationship("Person", lazy="joined")

    __table_args__ = (
        UniqueConstraint(
            "schedule_id", "person_id", "duty_date",
            name="uq_duty_mark",
        ),
    )