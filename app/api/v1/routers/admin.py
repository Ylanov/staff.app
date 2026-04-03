# app/api/v1/routers/admin.py

import json
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload, selectinload
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal, List, Optional, Any, Dict

from app.db.database import get_db
from app.models.user import User
from app.models.event import Event, Group, Slot, Position, DEFAULT_COLUMNS
from app.schemas.event import EventCreate, EventResponse, GroupCreate, GroupResponse, EventInstantiate, \
    EventUpdateTemplate
from app.api.dependencies import get_current_active_admin
from app.core.security import get_password_hash
from app.core.websockets import manager
from app.api.v1.routers.persons import upsert_person_from_slot

router = APIRouter()


# ─── Схемы роутера ───────────────────────────────────────────────────────────

class PositionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, strip_whitespace=True)


class PositionResponse(BaseModel):
    id: int
    name: str
    event_id: int
    model_config = ConfigDict(from_attributes=True)


class ColumnConfig(BaseModel):
    """Конфигурация одного столбца таблицы."""
    key:     str
    label:   str  = Field(..., min_length=1, max_length=100, strip_whitespace=True)
    type:    str  = Field(default="text")
    order:   int  = Field(default=0)
    width:   int  = Field(default=120, ge=40, le=600)
    visible: bool = True
    custom:  bool = False

# ДОБАВИТЬ ЭТОТ БЛОК:
class ColumnsUpdatePayload(BaseModel):
    columns: List[ColumnConfig]


class SlotAdminUpdate(BaseModel):
    version:     int
    position_id: Optional[int]  = None
    department:  str            = Field(..., min_length=1, max_length=100)
    callsign:    Optional[str]  = Field(default=None, max_length=50)
    note:        Optional[str]  = Field(default=None, max_length=500)
    full_name:   Optional[str]  = Field(default=None, max_length=300)
    rank:        Optional[str]  = Field(default=None, max_length=100)
    doc_number:  Optional[str]  = Field(default=None, max_length=100)
    # Данные кастомных столбцов — ключ:значение произвольно
    extra_data:  Optional[Dict[str, Any]] = None


class SlotAdminResponse(BaseModel):
    id:          int
    group_id:    int
    department:  str
    position_id: Optional[int]  = None
    callsign:    Optional[str]  = None
    note:        Optional[str]  = None
    rank:        Optional[str]  = None
    full_name:   Optional[str]  = None
    doc_number:  Optional[str]  = None
    version:     int
    extra_data:  Optional[Dict[str, Any]] = None
    model_config = ConfigDict(from_attributes=True)


class SlotQuickCreate(BaseModel):
    department:  str            = Field(..., min_length=1, max_length=100)
    position_id: Optional[int] = None


class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, strip_whitespace=True)
    password: str = Field(..., min_length=6, max_length=128)
    role:     Literal["admin", "department"] = "department"


class UserResponse(BaseModel):
    id:        int
    username:  str
    role:      str
    is_active: bool
    model_config = ConfigDict(from_attributes=True)


class EventUpdatePayload(BaseModel):
    title: Optional[str]       = Field(None, min_length=1, max_length=300, strip_whitespace=True)
    date:  Optional[date_type] = None


# ─── Столбцы (columns) ───────────────────────────────────────────────────────

@router.get(
    "/events/{event_id}/columns",
    response_model=List[ColumnConfig],
    summary="Получить конфигурацию столбцов для списка",
)
def get_event_columns(
        event_id:      int,
        db:            Session = Depends(get_db),
        current_admin: User    = Depends(get_current_active_admin),
):
    """
    Возвращает столбцы в порядке отображения.
    Если конфиг не задан — возвращает DEFAULT_COLUMNS.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")
    return event.get_columns()


@router.put(
    "/events/{event_id}/columns",
    response_model=List[ColumnConfig],
    summary="Сохранить конфигурацию столбцов",
)
async def update_event_columns(
        event_id:      int,
        payload:       ColumnsUpdatePayload, # <-- ИЗМЕНЕНО
        db:            Session = Depends(get_db),
        current_admin: User    = Depends(get_current_active_admin),
):
    columns = payload.columns # <-- ДОБАВЛЕНО, извлекаем список из объекта

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")

    if not any(c.visible for c in columns):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Должен остаться хотя бы один видимый столбец",
        )

    # Защита от дублирующихся ключей
    keys = [c.key for c in columns]
    if len(keys) != len(set(keys)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Обнаружены дублирующиеся ключи столбцов",
        )

    event.set_columns([c.model_dump() for c in columns])
    db.commit()

    await manager.broadcast({"event_id": event_id, "action": "update"})
    return event.get_columns()


# ─── Должности ───────────────────────────────────────────────────────────────

@router.get("/events/{event_id}/positions", response_model=List[PositionResponse])
def get_positions_for_event(
        event_id: int, db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    return db.query(Position).filter(Position.event_id == event_id).order_by(Position.name).all()


@router.post("/events/{event_id}/positions", response_model=PositionResponse, status_code=201)
async def create_position_for_event(
        event_id: int, position_in: PositionCreate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")

    new_position = Position(event_id=event.id, name=position_in.name)
    db.add(new_position)
    db.commit()
    db.refresh(new_position)
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return new_position


@router.delete("/positions/{position_id}")
async def delete_position(
        position_id: int, db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    pos = db.query(Position).filter(Position.id == position_id).first()
    if not pos:
        raise HTTPException(status_code=404, detail="Должность не найдена")
    event_id = pos.event_id
    db.delete(pos)
    db.commit()
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return {"message": "Должность удалена"}


# ─── Списки (Events) ─────────────────────────────────────────────────────────

@router.get("/events")
def get_all_events_admin(
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    events = db.query(Event).order_by(Event.date.asc().nullslast(), Event.id.desc()).all()
    return [
        {"id": e.id, "title": e.title,
         "date": e.date.isoformat() if e.date else None,
         "status": e.status, "is_template": e.is_template}
        for e in events
    ]


@router.patch("/events/{event_id}/status")
async def set_event_status(
        event_id: int, db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")
    if event.is_template:
        raise HTTPException(status_code=400, detail="Шаблон нельзя активировать")
    event.status = "draft" if event.status == "active" else "active"
    db.commit()
    await manager.broadcast({"action": "update"})
    return {"message": "Статус обновлён", "status": event.status}


@router.post("/events", response_model=EventResponse)
def create_event(
        event_in: EventCreate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    new_event = Event(
        title=event_in.title,
        date=event_in.date,
        status="draft",
        is_template=event_in.is_template,
    )
    db.add(new_event)
    db.commit()
    db.refresh(new_event)
    return new_event


@router.patch("/events/{event_id}", response_model=EventResponse)
async def update_event(
        event_id: int, payload: EventUpdatePayload,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")
    if payload.title is not None:
        event.title = payload.title
    if payload.date is not None:
        event.date = payload.date
    db.commit()
    db.refresh(event)
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return event


@router.delete("/events/{event_id}")
async def delete_event(
        event_id: int, db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")
    db.delete(event)
    db.commit()
    await manager.broadcast({"action": "update"})
    return {"message": "Список удалён"}


@router.patch("/events/{event_id}/template")
async def toggle_event_template(
        event_id: int, payload: EventUpdateTemplate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")
    event.is_template = payload.is_template
    db.commit()
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return {"message": "Статус изменён", "is_template": event.is_template}


@router.post("/events/{template_id}/instantiate")
async def instantiate_template(
        template_id: int,
        payload: EventInstantiate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    template = db.query(Event).filter(Event.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    if not template.is_template:
        raise HTTPException(status_code=400, detail="Это не шаблон. Пометьте список как шаблон перед генерацией.")

    positions = db.query(Position).filter(Position.event_id == template.id).all()
    groups = (
        db.query(Group)
        .options(selectinload(Group.slots))
        .filter(Group.event_id == template.id)
        .all()
    )

    created_ids = []
    WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    for target_date in payload.dates:
        weekday_str = WEEKDAYS[target_date.weekday()]

        new_event = Event(
            title=f"{template.title} ({target_date.strftime('%d.%m.%Y')}, {weekday_str})",
            date=target_date,
            status="active",
            is_template=False,
            # ✅ КЛЮЧЕВОЕ: копируем конфиг столбцов из шаблона
            columns_config=template.columns_config,
        )
        db.add(new_event)
        db.flush()

        pos_map = {}
        for pos in positions:
            new_pos = Position(event_id=new_event.id, name=pos.name)
            db.add(new_pos)
            db.flush()
            pos_map[pos.id] = new_pos.id

        for group in groups:
            new_group = Group(event_id=new_event.id, name=group.name, order_num=group.order_num)
            db.add(new_group)
            db.flush()

            for slot in group.slots:
                new_slot = Slot(
                    group_id=new_group.id,
                    position_id=pos_map.get(slot.position_id) if slot.position_id else None,
                    department=slot.department,
                    callsign=slot.callsign,
                    note=slot.note,
                    rank=None,
                    full_name=None,
                    doc_number=None,
                    extra_data=None,   # личные данные очищаются
                )
                db.add(new_slot)

        created_ids.append(new_event.id)

    db.commit()
    await manager.broadcast({"action": "update"})
    return {"message": "Успешно сгенерировано", "created_ids": created_ids}


# ─── Группы ──────────────────────────────────────────────────────────────────

@router.post("/events/{event_id}/groups", response_model=GroupResponse, status_code=201)
async def create_group_in_event(
        event_id: int, group_in: GroupCreate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")
    new_group = Group(event_id=event.id, name=group_in.name, order_num=group_in.order_num)
    db.add(new_group)
    db.commit()
    db.refresh(new_group)
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return new_group


@router.delete("/groups/{group_id}")
async def delete_group(
        group_id: int, db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    event_id = group.event_id
    db.delete(group)
    db.commit()
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return {"message": "Группа удалена"}


@router.get("/events/{event_id}/full")
def get_full_event_table(
        event_id: int,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Список не найден")

    groups = (
        db.query(Group)
        .filter(Group.event_id == event_id)
        .options(selectinload(Group.slots).joinedload(Slot.position))
        .order_by(Group.order_num)
        .all()
    )

    result = []
    for g in groups:
        slots_data = [
            {
                "id":           s.id,
                "group_id":     s.group_id,
                "department":   s.department,
                "rank":         s.rank,
                "full_name":    s.full_name,
                "doc_number":   s.doc_number,
                "callsign":     s.callsign,
                "note":         s.note,
                "position_id":  s.position_id,
                "position_name": s.position.name if s.position else None,
                "version":      s.version,
                "extra_data":   s.get_extra(),   # всегда dict, никогда не None
            }
            for s in sorted(g.slots, key=lambda s: s.id)
        ]
        result.append({"id": g.id, "name": g.name, "order_num": g.order_num, "slots": slots_data})

    return {
        "event": {
            "id":          event.id,
            "title":       event.title,
            "date":        event.date,
            "status":      event.status,
            "is_template": event.is_template,
        },
        "columns": event.get_columns(),   # ✅ конфиг столбцов в ответе
        "groups":  result,
    }


# ─── Строки (слоты) ───────────────────────────────────────────────────────────

@router.post("/groups/{group_id}/slots", response_model=SlotAdminResponse, status_code=201)
async def add_slot_to_group(
        group_id: int, slot_in: SlotQuickCreate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Группа не найдена")

    new_slot = Slot(group_id=group_id, department=slot_in.department, position_id=slot_in.position_id)
    db.add(new_slot)
    db.commit()
    db.refresh(new_slot)
    await manager.broadcast({"event_id": group.event_id, "action": "update"})
    # extra_data возвращаем как dict
    return {
        "id": new_slot.id,
        "group_id": new_slot.group_id,
        "department": new_slot.department,
        "position_id": new_slot.position_id,
        "callsign": new_slot.callsign,
        "note": new_slot.note,
        "rank": new_slot.rank,
        "full_name": new_slot.full_name,
        "doc_number": new_slot.doc_number,
        "version": new_slot.version,
        "extra_data": new_slot.get_extra(),
    }


@router.delete("/slots/{slot_id}")
async def delete_slot(
        slot_id: int, db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    slot = db.query(Slot).options(joinedload(Slot.group)).filter(Slot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    event_id = slot.group.event_id
    db.delete(slot)
    db.commit()
    await manager.broadcast({"event_id": event_id, "action": "update"})
    return {"message": "Строка удалена"}


@router.put("/slots/{slot_id}", response_model=SlotAdminResponse)
async def update_slot(
        slot_id: int,
        slot_in: SlotAdminUpdate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    slot = db.query(Slot).options(joinedload(Slot.group)).filter(Slot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    if slot.version != slot_in.version:
        raise HTTPException(
            status_code=409,
            detail="Данные были изменены другим пользователем. Таблица обновится автоматически.",
        )

    slot.position_id = slot_in.position_id
    slot.department  = slot_in.department
    slot.callsign    = slot_in.callsign  or None
    slot.note        = slot_in.note      or None
    slot.full_name   = slot_in.full_name or None
    slot.rank        = slot_in.rank      or None
    slot.doc_number  = slot_in.doc_number or None

    # Сохраняем кастомные поля — merge: сохраняем уже существующие + обновляем переданные
    if slot_in.extra_data is not None:
        existing_extra = slot.get_extra()
        existing_extra.update(slot_in.extra_data)
        slot.set_extra(existing_extra)

    slot.version += 1

    if slot.full_name and slot.full_name.strip():
        upsert_person_from_slot(db=db, full_name=slot.full_name,
                                rank=slot.rank, doc_number=slot.doc_number)

    db.commit()
    db.refresh(slot)
    await manager.broadcast({"event_id": slot.group.event_id, "action": "update"})

    return {
        "id": slot.id,
        "group_id": slot.group_id,
        "department": slot.department,
        "position_id": slot.position_id,
        "callsign": slot.callsign,
        "note": slot.note,
        "rank": slot.rank,
        "full_name": slot.full_name,
        "doc_number": slot.doc_number,
        "version": slot.version,
        "extra_data": slot.get_extra(),
    }


# ─── Пользователи ────────────────────────────────────────────────────────────

@router.get("/users", response_model=List[UserResponse])
def get_all_users(db: Session = Depends(get_db), current_admin: User = Depends(get_current_active_admin)):
    return db.query(User).order_by(User.id).all()


@router.post("/users", response_model=UserResponse, status_code=201)
def create_user(
        user_in: UserCreate,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    if db.query(User).filter(User.username == user_in.username).first():
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    new_user = User(username=user_in.username,
                    hashed_password=get_password_hash(user_in.password),
                    role=user_in.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.delete("/users/{user_id}")
def delete_user(
        user_id: int,
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.username == "admin":
        raise HTTPException(status_code=403, detail="Нельзя удалить базового администратора")
    if user.id == current_admin.id:
        raise HTTPException(status_code=403, detail="Нельзя удалить собственный аккаунт")
    db.delete(user)
    db.commit()
    return {"message": "Пользователь успешно удалён"}