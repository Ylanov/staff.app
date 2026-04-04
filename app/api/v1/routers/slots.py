# app/api/v1/routers/slots.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import date as date_today
from sqlalchemy import or_

from app.db.database import get_db
from app.models.user import User
from app.models.event import Slot, Event
from app.schemas.slot import SlotUpdate, SlotResponse
from app.api.dependencies import get_current_user
from app.core.websockets import manager
from app.api.v1.routers.persons import upsert_person_from_slot

router = APIRouter()


@router.get("/events", summary="Получить все рабочие списки для выпадающих меню")
def get_all_events(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """
    Возвращает списки для заполнения выпадающих меню.

    - Обычные пользователи (department): только НЕ-шаблоны, только активные, и не в прошлом.
    - Администратор: все списки включая шаблоны (нужны для настройки редактора).
    """
    query = db.query(Event)

    if current_user.role != "admin":
        today = date_today.today()
        # Department видит только активированные рабочие списки, начиная с сегодняшнего дня.
        query = query.filter(
            Event.is_template == False,
            Event.status == "active",
            or_(Event.date == None, Event.date >= today),  # ← скрывает прошлые
        )

    events = query.order_by(Event.date.asc().nullslast(), Event.id.desc()).all()

    return [
        {
            "id":          e.id,
            "title":       e.title,
            "date":        e.date.isoformat() if e.date else None,
            "status":      e.status,
            "is_template": e.is_template,
        }
        for e in events
    ]


@router.get(
    "/events/{event_id}/my-slots",
    response_model=List[SlotResponse],
    summary="Получить свои строки по списку",
)
def get_my_slots(
        event_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """
    Возвращает строки (слоты), назначенные текущему пользователю в данном списке.
    Администратор видит ВСЕ слоты списка (удобно для проверки).
    """
    query = (
        db.query(Slot)
        .join(Slot.group)
        .filter(Slot.group.has(event_id=event_id))
        .options(joinedload(Slot.group), joinedload(Slot.position))
    )

    if current_user.role != "admin":
        query = query.filter(Slot.department == current_user.username)

    return query.all()


@router.patch(
    "/{slot_id}",
    response_model=SlotResponse,
    summary="Заполнить / обновить свою строку",
)
async def fill_slot(
        slot_id: int,
        slot_in: SlotUpdate,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    slot = (
        db.query(Slot)
        .options(joinedload(Slot.group), joinedload(Slot.position))
        .filter(Slot.id == slot_id)
        .first()
    )

    if not slot:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    # ПРОВЕРКА ПРАВ:
    # Администратор может редактировать всё.
    # Управление (department) может редактировать только слоты, явно назначенные ему.
    if current_user.role != "admin":
        if not slot.department or slot.department != current_user.username:
            raise HTTPException(
                status_code=403,
                detail="Доступ запрещён. Это не ваша строка.",
            )

    # ПРОВЕРКА ВЕРСИИ
    if slot.version != slot_in.version:
        raise HTTPException(
            status_code=409,
            detail="Данные были изменены другим пользователем. Таблица обновится автоматически, проверьте данные."
        )

    update_data = slot_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key != 'version':  # Поле version не обновляем напрямую
            setattr(slot, key, value)

    slot.version += 1  # Увеличиваем версию

    if slot.full_name and slot.full_name.strip():
        upsert_person_from_slot(
            db=db,
            full_name=slot.full_name,
            rank=slot.rank,
            doc_number=slot.doc_number,
        )

    db.commit()
    db.refresh(slot)

    await manager.broadcast({"event_id": slot.group.event_id, "action": "update"})

    return slot