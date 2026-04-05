# app/api/v1/routers/duty.py
"""
Роутер для графиков наряда.

ИСПРАВЛЕНИЕ: Лишний запрос Position в diagnose_schedule.

Проблема (старый код):
    schedule = db.query(DutySchedule).filter(...)  # загружает со связями
    ...
    if schedule.position_id:
        pos = db.query(Position).filter(Position.id == schedule.position_id).first()  # ← ЛИШНИЙ запрос

DutySchedule модель имеет relationship на Position с lazy="joined",
значит schedule.position уже загружен вместе с schedule первым запросом.
Отдельный db.query(Position) был полностью лишним.

Решение: заменить на schedule.position — данные уже в памяти, SQL нет.

Маршруты:
  GET    /admin/schedules
  POST   /admin/schedules
  DELETE /admin/schedules/{id}
  GET    /admin/schedules/{id}/persons
  POST   /admin/schedules/{id}/persons
  DELETE /admin/schedules/{id}/persons/{person_id}
  GET    /admin/schedules/{id}/marks?year=&month=
  POST   /admin/schedules/{id}/marks
  GET    /admin/schedules/{id}/diagnose?date=YYYY-MM-DD
"""

import logging
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from pydantic import BaseModel, Field
from typing import Optional, List

from app.db.database import get_db
from app.models.user import User
from app.models.event import Event, Group, Slot, Position
from app.models.person import Person
from app.models.duty import DutySchedule, DutySchedulePerson, DutyMark
from app.api.dependencies import get_current_active_admin
from app.core.websockets import manager

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Схемы ────────────────────────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    title:         str           = Field(..., min_length=1, max_length=300, strip_whitespace=True)
    position_id:   Optional[int] = None
    position_name: Optional[str] = None


class ScheduleResponse(BaseModel):
    id:            int
    title:         str
    position_id:   Optional[int]
    position_name: Optional[str]

    class Config:
        from_attributes = True


class PersonInScheduleResponse(BaseModel):
    schedule_person_id: int
    person_id:          int
    full_name:          str
    rank:               Optional[str]
    order_num:          int

    class Config:
        from_attributes = True


class AddPersonPayload(BaseModel):
    person_id: int


class MarkPayload(BaseModel):
    person_id: int
    duty_date: date_type


# ─── Schedules CRUD ───────────────────────────────────────────────────────────

@router.get("/schedules", response_model=List[ScheduleResponse])
def list_schedules(
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    rows = db.query(DutySchedule).order_by(DutySchedule.id.desc()).all()
    result = []
    for s in rows:
        # position уже загружен через lazy="joined" в модели
        pos_name = s.position_name
        if not pos_name and s.position:
            pos_name = s.position.name
        result.append(ScheduleResponse(
            id=s.id, title=s.title,
            position_id=s.position_id, position_name=pos_name,
        ))
    return result


@router.post("/schedules", response_model=ScheduleResponse, status_code=201)
async def create_schedule(
    payload: ScheduleCreate,
    db:      Session = Depends(get_db),
    admin:   User    = Depends(get_current_active_admin),
):
    pos_name = payload.position_name
    if not pos_name and payload.position_id:
        pos = db.query(Position).filter(Position.id == payload.position_id).first()
        pos_name = pos.name if pos else None

    s = DutySchedule(
        title=payload.title,
        position_id=payload.position_id,
        position_name=pos_name,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    logger.debug(f"Created schedule id={s.id} title='{s.title}' position_id={s.position_id}")
    return ScheduleResponse(
        id=s.id, title=s.title,
        position_id=s.position_id, position_name=s.position_name,
    )


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: int,
    db:          Session = Depends(get_db),
    admin:       User    = Depends(get_current_active_admin),
):
    s = db.query(DutySchedule).filter(DutySchedule.id == schedule_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="График не найден")
    db.delete(s)
    db.commit()


# ─── Persons in schedule ──────────────────────────────────────────────────────

@router.get("/schedules/{schedule_id}/persons")
def get_persons_in_schedule(
    schedule_id: int,
    db:          Session = Depends(get_db),
    admin:       User    = Depends(get_current_active_admin),
):
    sps = (
        db.query(DutySchedulePerson)
        .filter(DutySchedulePerson.schedule_id == schedule_id)
        .order_by(DutySchedulePerson.order_num, DutySchedulePerson.id)
        .all()
    )
    return [
        {
            "schedule_person_id": sp.id,
            "person_id":   sp.person_id,
            "full_name":   sp.person.full_name,
            "rank":        sp.person.rank,
            "order_num":   sp.order_num,
        }
        for sp in sps
    ]


@router.post("/schedules/{schedule_id}/persons", status_code=201)
async def add_person_to_schedule(
    schedule_id: int,
    payload:     AddPersonPayload,
    db:          Session = Depends(get_db),
    admin:       User    = Depends(get_current_active_admin),
):
    schedule = db.query(DutySchedule).filter(DutySchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="График не найден")

    person = db.query(Person).filter(Person.id == payload.person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Человек не найден")

    # Проверяем что человек ещё не в графике
    existing = db.query(DutySchedulePerson).filter(
        DutySchedulePerson.schedule_id == schedule_id,
        DutySchedulePerson.person_id   == payload.person_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Человек уже в графике")

    max_order = db.query(DutySchedulePerson).filter(
        DutySchedulePerson.schedule_id == schedule_id
    ).count()

    sp = DutySchedulePerson(
        schedule_id=schedule_id,
        person_id=payload.person_id,
        order_num=max_order,
    )
    db.add(sp)
    db.commit()
    return {"ok": True}


@router.delete("/schedules/{schedule_id}/persons/{person_id}", status_code=204)
async def remove_person_from_schedule(
    schedule_id: int,
    person_id:   int,
    db:          Session = Depends(get_db),
    admin:       User    = Depends(get_current_active_admin),
):
    sp = db.query(DutySchedulePerson).filter(
        DutySchedulePerson.schedule_id == schedule_id,
        DutySchedulePerson.person_id   == person_id,
    ).first()
    if not sp:
        raise HTTPException(status_code=404, detail="Не найдено")
    db.delete(sp)
    db.commit()


# ─── Marks ────────────────────────────────────────────────────────────────────

@router.get("/schedules/{schedule_id}/marks")
def get_marks(
    schedule_id: int,
    year:  int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    from calendar import monthrange
    _, days_in_month = monthrange(year, month)
    date_from = date_type(year, month, 1)
    date_to   = date_type(year, month, days_in_month)

    marks = (
        db.query(DutyMark)
        .filter(
            DutyMark.schedule_id == schedule_id,
            DutyMark.duty_date   >= date_from,
            DutyMark.duty_date   <= date_to,
        )
        .all()
    )
    return [
        {
            "id":        m.id,
            "person_id": m.person_id,
            "duty_date": m.duty_date.isoformat(),
        }
        for m in marks
    ]


@router.post("/schedules/{schedule_id}/marks")
async def toggle_mark(
    schedule_id: int,
    payload:     MarkPayload,
    db:          Session = Depends(get_db),
    admin:       User    = Depends(get_current_active_admin),
):
    """
    Поставить или снять отметку наряда.
    При постановке — автозаполняет слоты в списках за эту дату
    где position_id совпадает с должностью графика.
    Использует joinedload для избежания N+1.
    """
    schedule = db.query(DutySchedule).filter(DutySchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="График не найден")

    person = db.query(Person).filter(Person.id == payload.person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Человек не найден")

    # ── Снять метку если уже стоит ────────────────────────────────────────────
    existing = db.query(DutyMark).filter(
        DutyMark.schedule_id == schedule_id,
        DutyMark.person_id   == payload.person_id,
        DutyMark.duty_date   == payload.duty_date,
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        logger.debug(f"Removed mark: person={person.full_name} date={payload.duty_date}")
        return {"action": "removed", "filled_events_count": 0}

    # ── Поставить метку ───────────────────────────────────────────────────────
    mark = DutyMark(
        schedule_id=schedule_id,
        person_id=payload.person_id,
        duty_date=payload.duty_date,
    )
    db.add(mark)

    logger.debug(f"Toggle ON: person='{person.full_name}' date={payload.duty_date}")

    # ── Автозаполнение ────────────────────────────────────────────────────────
    affected_event_ids = set()
    fill_log           = []

    if not schedule.position_id:
        logger.warning("schedule.position_id is None — автозаполнение пропущено")
    else:
        # Загружаем группы и слоты ОДНИМ запросом (N+1 Fix)
        events_on_date = (
            db.query(Event)
            .options(joinedload(Event.groups).joinedload(Group.slots))
            .filter(
                Event.date        == payload.duty_date,
                Event.is_template == False,
            )
            .all()
        )

        logger.debug(f"Events on {payload.duty_date}: {len(events_on_date)}")

        if not events_on_date:
            nearby = db.execute(
                text(
                    "SELECT id, title, date FROM events "
                    "WHERE date IS NOT NULL AND is_template = false "
                    "ORDER BY ABS(date - :d) LIMIT 5"
                ),
                {"d": payload.duty_date}
            ).fetchall()
            logger.warning(f"Нет списков на {payload.duty_date}. Ближайшие: {nearby}")
        else:
            for event in events_on_date:
                for group in event.groups:
                    for slot in group.slots:
                        if slot.position_id == schedule.position_id:
                            old_name = slot.full_name
                            slot.full_name = person.full_name
                            if person.rank:
                                slot.rank = person.rank
                            slot.version += 1
                            affected_event_ids.add(event.id)
                            fill_log.append({
                                "event_id":    event.id,
                                "event_title": event.title,
                                "slot_id":     slot.id,
                                "old_name":    old_name,
                                "new_name":    person.full_name,
                            })

    logger.debug(f"Заполнено событий: {len(affected_event_ids)}, слотов: {len(fill_log)}")
    db.commit()

    # Рассылаем WebSocket-уведомления
    for eid in affected_event_ids:
        await manager.broadcast({"event_id": eid, "action": "update"})

    return {
        "action":              "added",
        "filled_events_count": len(affected_event_ids),
        "filled_slots_count":  len(fill_log),
        "fill_log":            fill_log,
        "debug": {
            "schedule_position_id": schedule.position_id,
            "duty_date":            payload.duty_date.isoformat(),
        },
    }


# ─── Диагностика ──────────────────────────────────────────────────────────────

@router.get("/schedules/{schedule_id}/diagnose")
def diagnose_schedule(
    schedule_id: int,
    date:        str = Query(..., description="YYYY-MM-DD"),
    db:          Session = Depends(get_db),
    admin:       User    = Depends(get_current_active_admin),
):
    """
    Диагностический эндпоинт: показывает почему автозаполнение
    сработало или не сработало для заданной даты.

    ИСПРАВЛЕНО: убран лишний запрос к таблице positions.

    Старый код делал:
        schedule = db.query(DutySchedule)...  # загружает с position (lazy="joined")
        pos = db.query(Position).filter(Position.id == schedule.position_id).first()  # ← ЛИШНИЙ

    DutySchedule.position загружается автоматически через lazy="joined" в модели.
    Достаточно обратиться к schedule.position — данные уже в памяти, SQL не нужен.
    """
    from datetime import date as date_type_cls

    # position загружается автоматически (lazy="joined" в DutySchedule)
    schedule = db.query(DutySchedule).filter(DutySchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="График не найден")

    try:
        check_date = date_type_cls.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Формат даты: YYYY-MM-DD")

    events = (
        db.query(Event)
        .options(joinedload(Event.groups).joinedload(Group.slots).joinedload(Slot.position))
        .filter(Event.date == check_date, Event.is_template == False)
        .all()
    )

    events_info = []
    for event in events:
        groups_info = []
        for group in event.groups:
            slots_info = [
                {
                    "slot_id":          s.id,
                    "position_id":      s.position_id,
                    "position_name":    s.position.name if s.position else None,
                    "full_name":        s.full_name,
                    "matches_schedule": s.position_id == schedule.position_id,
                }
                for s in group.slots
            ]
            groups_info.append({
                "group_id":   group.id,
                "group_name": group.name,
                "slots":      slots_info,
            })
        events_info.append({
            "event_id":    event.id,
            "event_title": event.title,
            "event_date":  event.date.isoformat() if event.date else None,
            "groups":      groups_info,
        })

    # ИСПРАВЛЕНО: используем schedule.position вместо отдельного db.query(Position)
    # position уже загружен вместе с schedule через lazy="joined"
    position = None
    if schedule.position:
        position = {
            "id":   schedule.position.id,
            "name": schedule.position.name,
        }

    return {
        "schedule": {
            "id":            schedule.id,
            "title":         schedule.title,
            "position_id":   schedule.position_id,
            "position_name": schedule.position_name,
        },
        "position_in_db": position,
        "check_date":     check_date.isoformat(),
        "events_found":   len(events),
        "events":         events_info,
        "will_autofill":  schedule.position_id is not None and len(events) > 0,
        "diagnosis": (
            "OK: позиция привязана и есть списки на эту дату"
            if schedule.position_id and events
            else "⚠️ График создан без привязки к должности — автозаполнение невозможно"
            if not schedule.position_id
            else f"⚠️ Нет списков на дату {check_date} — создайте список с этой датой"
        ),
    }