# app/api/v1/routers/slots.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List

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

    - Обычные пользователи (department): только НЕ-шаблоны, только активные.
      Шаблоны им видеть не нужно — они работают только с рабочими списками.
    - Администратор: все списки включая шаблоны (нужны для настройки редактора).

    БАГ-ФИКс: раньше шаблоны попадали в список пользователей из управления,
    они могли случайно открыть шаблон и начать вписывать туда людей.
    """
    query = db.query(Event)

    if current_user.role != "admin":
        # Department видит только активированные рабочие списки.
        # status="draft" — список ещё не готов, админ не выпустил его.
        # status="active" — список активирован и готов к заполнению.
        # Шаблоны (is_template=True) никогда не показываем управлениям.
        query = query.filter(
            Event.is_template == False,
            Event.status == "active",
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

    if slot.department != current_user.username and current_user.role != "admin":
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