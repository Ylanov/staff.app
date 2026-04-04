# app/models/combat_calc.py
"""
Боевой расчёт — система заполнения документов с фиксированной структурой.

CombatCalcTemplate  — шаблон документа (структура строк в JSON)
CombatCalcInstance  — экземпляр на конкретную дату
CombatCalcSlot      — заполняемая ячейка (ФИО + звание от управления)
"""

import json
from sqlalchemy import Column, Integer, String, Date, Text, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.database import Base


class CombatCalcTemplate(Base):
    """
    Шаблон боевого расчёта.
    structure_json — JSON со списком секций и строк.
    Структура:
    {
      "sections": [
        {
          "title": "Оповещение личного состава",
          "rows": [
            {
              "key": "r1",
              "label": "Оповещение в общежитии №1",
              "time": "Ч+0.10",
              "who_provides": "2 чел. от базы (обеспечения)",
              "slots": [
                {"index": 0, "location": "1 под.", "department": "base"},
                {"index": 1, "location": "2 под.", "department": "base"}
              ]
            }
          ]
        }
      ]
    }
    """
    __tablename__ = "combat_calc_templates"

    id             = Column(Integer, primary_key=True, index=True)
    title          = Column(String, nullable=False)
    description    = Column(String, nullable=True)
    structure_json = Column(Text, nullable=False, default="{}")
    is_active      = Column(Boolean, default=True, nullable=False)

    instances = relationship("CombatCalcInstance", back_populates="template",
                             cascade="all, delete-orphan")

    def get_structure(self) -> dict:
        try:
            return json.loads(self.structure_json)
        except (json.JSONDecodeError, TypeError):
            return {"sections": []}

    def set_structure(self, data: dict) -> None:
        self.structure_json = json.dumps(data, ensure_ascii=False)


class CombatCalcInstance(Base):
    """Экземпляр расчёта на конкретную дату."""
    __tablename__ = "combat_calc_instances"

    id          = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("combat_calc_templates.id", ondelete="CASCADE"),
                         nullable=False)
    calc_date   = Column(Date, nullable=False)
    status      = Column(String, default="active", nullable=False)  # draft / active / closed

    template = relationship("CombatCalcTemplate", back_populates="instances")
    slots    = relationship("CombatCalcSlot", back_populates="instance",
                            cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("template_id", "calc_date", name="uq_combat_calc_instance"),
    )


class CombatCalcSlot(Base):
    """
    Заполняемая ячейка расчёта.
    row_key + slot_index уникально идентифицируют слот в шаблоне.
    """
    __tablename__ = "combat_calc_slots"

    id          = Column(Integer, primary_key=True, index=True)
    instance_id = Column(Integer, ForeignKey("combat_calc_instances.id", ondelete="CASCADE"),
                         nullable=False)
    row_key     = Column(String, nullable=False)   # совпадает с key в структуре шаблона
    slot_index  = Column(Integer, default=0, nullable=False)  # порядковый индекс в строке
    department  = Column(String, nullable=True)    # какое управление заполняет
    full_name   = Column(String, nullable=True)
    rank        = Column(String, nullable=True)
    note        = Column(String, nullable=True)
    version     = Column(Integer, default=1, nullable=False)

    instance = relationship("CombatCalcInstance", back_populates="slots")

    __table_args__ = (
        UniqueConstraint("instance_id", "row_key", "slot_index",
                         name="uq_combat_calc_slot"),
    )