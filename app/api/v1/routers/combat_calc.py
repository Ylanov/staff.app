# app/api/v1/routers/combat_calc.py
"""
API для боевого расчёта.

Администратор:
  GET    /admin/combat/templates                    – список шаблонов
  GET    /admin/combat/templates/{id}               – детали + структура
  POST   /admin/combat/instances                    – создать экземпляр (дата + шаблон)
  GET    /admin/combat/instances?date=YYYY-MM-DD    – экземпляры за дату
  DELETE /admin/combat/instances/{id}               – удалить экземпляр
  GET    /admin/combat/instances/{id}/full          – полный экземпляр со всеми слотами
  PATCH  /admin/combat/instances/{id}/status        – сменить статус

Управления (заполнение):
  GET    /combat/instances/today                    – активные экземпляры сегодня
  GET    /combat/instances/{id}/my-slots            – слоты своего управления
  PUT    /combat/slots/{id}                         – заполнить слот
"""

from datetime import date as date_type, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List

from app.db.database import get_db
from app.models.user import User
from app.models.combat_calc import CombatCalcTemplate, CombatCalcInstance, CombatCalcSlot
from app.api.dependencies import get_current_user, get_current_active_admin
from app.core.websockets import manager

router = APIRouter()


# ─── Схемы ───────────────────────────────────────────────────────────────────

class TemplateResponse(BaseModel):
    id:          int
    title:       str
    description: Optional[str]
    is_active:   bool

    class Config:
        from_attributes = True


class InstanceCreate(BaseModel):
    template_id: int
    calc_date:   date_type


class InstanceResponse(BaseModel):
    id:          int
    template_id: int
    template_title: str
    calc_date:   date_type
    status:      str

    class Config:
        from_attributes = True


class SlotFill(BaseModel):
    version:   int
    full_name: Optional[str] = Field(default=None, max_length=300)
    rank:      Optional[str] = Field(default=None, max_length=100)
    note:      Optional[str] = Field(default=None, max_length=500)


# ─── Вспомогательная функция: синхронизация слотов ───────────────────────────

def _sync_slots(db: Session, instance: CombatCalcInstance) -> None:
    """
    Создаёт недостающие слоты в CombatCalcSlot по структуре шаблона.
    Вызывается при создании экземпляра и при запросе данных.
    Идемпотентна: уже существующие слоты не трогает.
    """
    structure = instance.template.get_structure()

    # Собираем все (row_key, slot_index) из шаблона
    template_slots = set()
    dept_map = {}   # (row_key, slot_index) → department
    for section in structure.get("sections", []):
        for row in section.get("rows", []):
            key = row["key"]
            for slot in row.get("slots", []):
                idx  = slot["index"]
                dept = slot.get("department", "")
                template_slots.add((key, idx))
                dept_map[(key, idx)] = dept

    # Собираем уже существующие слоты
    existing = {
        (s.row_key, s.slot_index)
        for s in db.query(CombatCalcSlot)
        .filter(CombatCalcSlot.instance_id == instance.id)
        .all()
    }

    # Создаём недостающие
    new_slots = []
    for (key, idx) in template_slots - existing:
        new_slots.append(CombatCalcSlot(
            instance_id=instance.id,
            row_key=key,
            slot_index=idx,
            department=dept_map.get((key, idx), ""),
        ))

    if new_slots:
        db.add_all(new_slots)
        db.commit()


# ─── Admin: Шаблоны ───────────────────────────────────────────────────────────

@router.get("/combat/templates", response_model=List[TemplateResponse])
def list_templates(
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    return db.query(CombatCalcTemplate).order_by(CombatCalcTemplate.id).all()


@router.get("/combat/templates/{template_id}")
def get_template(
    template_id: int,
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    t = db.query(CombatCalcTemplate).filter(CombatCalcTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    return {
        "id":          t.id,
        "title":       t.title,
        "description": t.description,
        "is_active":   t.is_active,
        "structure":   t.get_structure(),
    }


# ─── Admin: Экземпляры ────────────────────────────────────────────────────────

@router.get("/combat/instances")
def list_instances(
    calc_date: Optional[date_type] = Query(None),
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    q = db.query(CombatCalcInstance).join(CombatCalcInstance.template)
    if calc_date:
        q = q.filter(CombatCalcInstance.calc_date == calc_date)
    instances = q.order_by(CombatCalcInstance.calc_date.desc()).limit(100).all()
    return [
        {
            "id":             i.id,
            "template_id":    i.template_id,
            "template_title": i.template.title,
            "calc_date":      i.calc_date.isoformat(),
            "status":         i.status,
        }
        for i in instances
    ]


@router.post("/combat/instances", status_code=201)
async def create_instance(
    payload: InstanceCreate,
    db:      Session = Depends(get_db),
    admin:   User    = Depends(get_current_active_admin),
):
    template = db.query(CombatCalcTemplate).filter(
        CombatCalcTemplate.id == payload.template_id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")

    # Проверяем дубликат
    existing = db.query(CombatCalcInstance).filter(
        CombatCalcInstance.template_id == payload.template_id,
        CombatCalcInstance.calc_date   == payload.calc_date,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Расчёт по этому шаблону на {payload.calc_date} уже существует"
        )

    instance = CombatCalcInstance(
        template_id=payload.template_id,
        calc_date=payload.calc_date,
        status="active",
    )
    db.add(instance)
    db.commit()
    db.refresh(instance)

    # Создаём слоты по структуре шаблона
    _sync_slots(db, instance)

    await manager.broadcast({"action": "combat_calc_update"})
    return {
        "id":             instance.id,
        "template_id":    instance.template_id,
        "template_title": template.title,
        "calc_date":      instance.calc_date.isoformat(),
        "status":         instance.status,
    }


@router.delete("/combat/instances/{instance_id}", status_code=204)
async def delete_instance(
    instance_id: int,
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    inst = db.query(CombatCalcInstance).filter(CombatCalcInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Экземпляр не найден")
    db.delete(inst)
    db.commit()


@router.patch("/combat/instances/{instance_id}/status")
async def set_instance_status(
    instance_id: int,
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    inst = db.query(CombatCalcInstance).filter(CombatCalcInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Экземпляр не найден")
    cycle = {"draft": "active", "active": "closed", "closed": "draft"}
    inst.status = cycle.get(inst.status, "active")
    db.commit()
    return {"status": inst.status}


@router.get("/combat/instances/{instance_id}/full")
def get_instance_full(
    instance_id: int,
    db:    Session = Depends(get_db),
    admin: User    = Depends(get_current_active_admin),
):
    """Возвращает экземпляр с шаблонной структурой и заполненными слотами."""
    inst = db.query(CombatCalcInstance).filter(CombatCalcInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Экземпляр не найден")

    _sync_slots(db, inst)

    # Слоты в виде словаря {row_key: {slot_index: slot_data}}
    slots_map = {}
    for slot in inst.slots:
        if slot.row_key not in slots_map:
            slots_map[slot.row_key] = {}
        slots_map[slot.row_key][slot.slot_index] = {
            "id":         slot.id,
            "full_name":  slot.full_name,
            "rank":       slot.rank,
            "note":       slot.note,
            "department": slot.department,
            "version":    slot.version,
        }

    structure = inst.template.get_structure()

    return {
        "instance": {
            "id":             inst.id,
            "template_id":    inst.template_id,
            "template_title": inst.template.title,
            "calc_date":      inst.calc_date.isoformat(),
            "status":         inst.status,
        },
        "structure": structure,
        "slots_map": slots_map,
    }


# ─── Department: заполнение ───────────────────────────────────────────────────

@router.get("/combat/my/instances")
def get_my_instances(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Возвращает активные экземпляры расчёта.
    Для управления — только активные.
    Для администратора — все.
    """
    q = db.query(CombatCalcInstance).join(CombatCalcInstance.template)

    if current_user.role != "admin":
        q = q.filter(CombatCalcInstance.status == "active")

    instances = q.order_by(CombatCalcInstance.calc_date.desc()).limit(50).all()
    return [
        {
            "id":             i.id,
            "template_id":    i.template_id,
            "template_title": i.template.title,
            "calc_date":      i.calc_date.isoformat(),
            "status":         i.status,
        }
        for i in instances
    ]


@router.get("/combat/instances/{instance_id}/view")
def get_instance_for_user(
    instance_id:  int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Возвращает полный экземпляр для заполнения пользователем.
    Включает шаблонную структуру и все слоты.
    """
    inst = db.query(CombatCalcInstance).filter(CombatCalcInstance.id == instance_id).first()
    if not inst:
        raise HTTPException(status_code=404, detail="Расчёт не найден")

    if current_user.role != "admin" and inst.status != "active":
        raise HTTPException(status_code=403, detail="Расчёт не активен")

    _sync_slots(db, inst)

    slots_map = {}
    for slot in inst.slots:
        if slot.row_key not in slots_map:
            slots_map[slot.row_key] = {}
        slots_map[slot.row_key][slot.slot_index] = {
            "id":         slot.id,
            "full_name":  slot.full_name,
            "rank":       slot.rank,
            "note":       slot.note,
            "department": slot.department,
            "version":    slot.version,
        }

    return {
        "instance": {
            "id":             inst.id,
            "template_id":    inst.template_id,
            "template_title": inst.template.title,
            "calc_date":      inst.calc_date.isoformat(),
            "status":         inst.status,
        },
        "structure":    inst.template.get_structure(),
        "slots_map":    slots_map,
        "my_department": current_user.username,
    }


@router.put("/combat/slots/{slot_id}")
async def fill_slot(
    slot_id:      int,
    payload:      SlotFill,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    slot = db.query(CombatCalcSlot).filter(CombatCalcSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Слот не найден")

    # Проверяем статус экземпляра
    inst = db.query(CombatCalcInstance).filter(
        CombatCalcInstance.id == slot.instance_id
    ).first()
    if inst and inst.status == "closed" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Расчёт закрыт для редактирования")

    if slot.version != payload.version:
        raise HTTPException(
            status_code=409,
            detail="Конфликт версий. Перезагрузите страницу."
        )

    slot.full_name = payload.full_name or None
    slot.rank      = payload.rank      or None
    slot.note      = payload.note      or None
    slot.version  += 1

    # Если не задан department, ставим текущего пользователя
    if not slot.department:
        slot.department = current_user.username

    db.commit()

    await manager.broadcast({
        "action": "combat_calc_slot_update",
        "instance_id": slot.instance_id,
    })

    return {
        "id":        slot.id,
        "full_name": slot.full_name,
        "rank":      slot.rank,
        "note":      slot.note,
        "version":   slot.version,
    }