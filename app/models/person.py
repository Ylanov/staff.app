# app/models/person.py

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime
from app.db.database import Base


class Person(Base):
    """
    Центральный справочник людей.

    Записи создаются/обновляются автоматически когда пользователи
    из управлений заполняют слоты (ФИО + звание + номер документа).
    Администратор может просматривать и редактировать базу вручную.
    """
    __tablename__ = "persons"

    id         = Column(Integer, primary_key=True, index=True)
    full_name  = Column(String, nullable=False, index=True, unique=True)
    rank       = Column(String, nullable=True)
    doc_number = Column(String, nullable=True)
    department = Column(String, nullable=True)  # username управления-владельца

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True),
                        default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))