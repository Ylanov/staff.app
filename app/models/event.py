# app/models/event.py
import json
from sqlalchemy import Column, Integer, String, ForeignKey, Date, Boolean, Text
from sqlalchemy.orm import relationship
from app.db.database import Base


# ─── Дефолтная конфигурация столбцов ─────────────────────────────────────────
DEFAULT_COLUMNS = [
    {"key": "full_name",   "label": "ФИО",         "type": "text",            "order": 0, "width": 200, "visible": True, "custom": False},
    {"key": "rank",        "label": "Звание",      "type": "text",            "order": 1, "width": 110, "visible": True, "custom": False},
    {"key": "doc_number",  "label": "№ Документа", "type": "text",            "order": 2, "width": 130, "visible": True, "custom": False},
    {"key": "position_id", "label": "Должность",   "type": "select_position", "order": 3, "width": 160, "visible": True, "custom": False},
    {"key": "callsign",    "label": "Позывной",    "type": "text",            "order": 4, "width": 100, "visible": True, "custom": False},
    {"key": "department",  "label": "Квота",       "type": "select_dept",     "order": 5, "width": 140, "visible": True, "custom": False},
    {"key": "note",        "label": "Примечание",  "type": "text",            "order": 6, "width": 160, "visible": True, "custom": False},
]


class Event(Base):
    __tablename__ = "events"

    id             = Column(Integer, primary_key=True, index=True)
    title          = Column(String, nullable=False)
    date           = Column(Date, nullable=True)
    status         = Column(String, default="draft")
    is_template    = Column(Boolean, default=False, nullable=False)
    columns_config = Column(Text, nullable=True)

    groups    = relationship("Group",    back_populates="event", cascade="all, delete-orphan")

    def get_columns(self) -> list:
        if self.columns_config:
            try:
                return json.loads(self.columns_config)
            except (json.JSONDecodeError, ValueError):
                pass
        return [col.copy() for col in DEFAULT_COLUMNS]

    def set_columns(self, columns: list) -> None:
        self.columns_config = json.dumps(columns, ensure_ascii=False)


class Group(Base):
    __tablename__ = "groups"

    id        = Column(Integer, primary_key=True, index=True)
    event_id  = Column(Integer, ForeignKey("events.id"))
    name      = Column(String, nullable=False)
    order_num = Column(Integer, default=0)
    version   = Column(Integer, server_default="1", default=1, nullable=False)

    event = relationship("Event", back_populates="groups")
    slots = relationship("Slot", back_populates="group", cascade="all, delete-orphan")


class Position(Base):
    __tablename__ = "positions"
    id   = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    slots = relationship("Slot", back_populates="position")


class Slot(Base):
    __tablename__ = "slots"

    id          = Column(Integer, primary_key=True, index=True)
    group_id    = Column(Integer, ForeignKey("groups.id"))
    position_id = Column(Integer, ForeignKey("positions.id"), nullable=True)
    department  = Column(String, nullable=False)
    rank        = Column(String, nullable=True)
    full_name   = Column(String, nullable=True)
    doc_number  = Column(String, nullable=True)
    callsign    = Column(String, nullable=True)
    note        = Column(String, nullable=True)
    version     = Column(Integer, default=1, nullable=False)
    extra_data  = Column(Text, nullable=True)   # JSON для кастомных столбцов

    group    = relationship("Group",    back_populates="slots")
    position = relationship("Position", back_populates="slots")

    def get_extra(self) -> dict:
        if self.extra_data:
            try:
                return json.loads(self.extra_data)
            except (json.JSONDecodeError, ValueError):
                pass
        return {}

    def set_extra(self, data: dict) -> None:
        self.extra_data = json.dumps(data, ensure_ascii=False) if data else None