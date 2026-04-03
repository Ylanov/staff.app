# app/api/v1/routers/persons.py

import io
from typing import List, Optional
import openpyxl

from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field, ConfigDict

from app.db.database import get_db
from app.models.person import Person
from app.models.user import User
from app.api.dependencies import get_current_user, get_current_active_admin

router = APIRouter()


# ─── Схемы ────────────────────────────────────────────────────────────────────

class PersonCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=300, strip_whitespace=True)
    rank: Optional[str] = Field(None, max_length=100, strip_whitespace=True)
    doc_number: Optional[str] = Field(None, max_length=100, strip_whitespace=True)
    department: Optional[str] = Field(None, max_length=100, strip_whitespace=True)


class PersonUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=300, strip_whitespace=True)
    rank: Optional[str] = Field(None, max_length=100, strip_whitespace=True)
    doc_number: Optional[str] = Field(None, max_length=100, strip_whitespace=True)
    department: Optional[str] = Field(None, max_length=100, strip_whitespace=True)


class PersonResponse(BaseModel):
    id: int
    full_name: str
    rank: Optional[str] = None
    doc_number: Optional[str] = None
    department: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Поиск (доступен всем авторизованным пользователям) ──────────────────────

@router.get(
    "/search",
    response_model=List[PersonResponse],
    summary="Поиск человека по ФИО (для автодополнения)",
)
def search_persons(
        q: str = Query(..., min_length=2, description="Часть ФИО для поиска"),
        limit: int = Query(10, ge=1, le=50),
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    """
    Возвращает людей чьё ФИО содержит строку q.
    """
    query = db.query(Person).filter(Person.full_name.ilike(f"%{q}%"))

    # Управление видит только своих людей в автодополнении
    if current_user.role != "admin":
        query = query.filter(Person.department == current_user.username)

    return query.order_by(Person.full_name).limit(limit).all()


# ─── CRUD (Доступно всем, но с разделением по управлениям) ───────────────────

@router.get(
    "",
    response_model=List[PersonResponse],
    summary="Получить базу людей",
)
def get_all_persons(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
        skip: int = Query(0, ge=0),
        limit: int = Query(500, ge=1, le=2000),
        q: Optional[str] = Query(None),
):
    query = db.query(Person)

    # Управление видит только своих людей
    if current_user.role != "admin":
        query = query.filter(Person.department == current_user.username)

    if q:
        query = query.filter(Person.full_name.ilike(f"%{q}%"))

    return query.order_by(Person.full_name).offset(skip).limit(limit).all()


@router.post(
    "",
    response_model=PersonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить человека",
)
def create_person(
        person_in: PersonCreate,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    # Управление может добавлять только себе; у себя department = свой username
    department = person_in.department if current_user.role == "admin" else current_user.username

    existing = db.query(Person).filter(Person.full_name.ilike(person_in.full_name)).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Человек с таким ФИО уже есть в базе",
        )

    person = Person(
        full_name=person_in.full_name,
        rank=person_in.rank or None,
        doc_number=person_in.doc_number or None,
        department=department,
    )
    db.add(person)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Человек с таким ФИО уже есть в базе",
        )
    db.refresh(person)
    return person


@router.put(
    "/{person_id}",
    response_model=PersonResponse,
    summary="Обновить данные человека",
)
def update_person(
        person_id: int,
        person_in: PersonUpdate,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Запись не найдена")

    # Управление может редактировать только своих
    if current_user.role != "admin" and person.department != current_user.username:
        raise HTTPException(status_code=403, detail="Нет доступа")

    if person_in.full_name is not None: person.full_name = person_in.full_name
    if person_in.rank is not None: person.rank = person_in.rank or None
    if person_in.doc_number is not None: person.doc_number = person_in.doc_number or None

    # Менять управление может только администратор
    if person_in.department is not None and current_user.role == "admin":
        person.department = person_in.department or None

    db.commit()
    db.refresh(person)
    return person


@router.delete(
    "/{person_id}",
    summary="Удалить человека из базы",
)
def delete_person(
        person_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user),
):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Человек не найден")

    # Управление может удалять только своих
    if current_user.role != "admin" and person.department != current_user.username:
        raise HTTPException(status_code=403, detail="Нет доступа")

    db.delete(person)
    db.commit()
    return {"message": "Удалён из базы"}


# ─── Внутренняя функция: upsert при заполнении слота ─────────────────────────

def upsert_person_from_slot(db: Session, full_name: str, rank: str | None, doc_number: str | None,
                            department: str | None = None) -> None:
    """Создаёт или обновляет запись в базе людей при сохранении слота."""
    if not full_name or not full_name.strip():
        return

    full_name = full_name.strip()
    person = db.query(Person).filter(Person.full_name.ilike(full_name)).first()

    if person:
        if rank and not person.rank:       person.rank = rank.strip()
        if doc_number and not person.doc_number: person.doc_number = doc_number.strip()
        if department and not person.department: person.department = department.strip()
    else:
        person = Person(
            full_name=full_name,
            rank=rank.strip() if rank else None,
            doc_number=doc_number.strip() if doc_number else None,
            department=department.strip() if department else None
        )
        db.add(person)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()


# ─── Массовый импорт из Excel (оставлен только для админа) ───────────────────

@router.post(
    "/import",
    summary="Массовый импорт из Excel",
)
async def import_persons_from_excel(
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_admin: User = Depends(get_current_active_admin),
):
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Формат файла должен быть .xlsx")

    contents = await file.read()

    try:
        wb = openpyxl.load_workbook(io.BytesIO(contents), data_only=True)
        sheet = wb.active
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось прочитать Excel файл")

    existing_records = {p.full_name.lower(): p for p in db.query(Person).all()}

    new_persons = []
    updated_count = 0
    added_count = 0

    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue

        full_name = str(row[0]).strip()
        if not full_name or len(full_name) < 2:
            continue

        rank = str(row[1]).strip() if len(row) > 1 and row[1] is not None else None
        doc = str(row[2]).strip() if len(row) > 2 and row[2] is not None else None

        if rank == "None" or not rank: rank = None
        if doc == "None" or not doc: doc = None

        existing_person = existing_records.get(full_name.lower())

        if existing_person:
            changed = False
            if rank and not existing_person.rank:
                existing_person.rank = rank
                changed = True
            if doc and not existing_person.doc_number:
                existing_person.doc_number = doc
                changed = True

            if changed:
                updated_count += 1
        else:
            new_p = Person(full_name=full_name, rank=rank, doc_number=doc)
            new_persons.append(new_p)
            existing_records[full_name.lower()] = new_p

    if new_persons:
        db.add_all(new_persons)
        added_count = len(new_persons)

    db.commit()

    return {
        "message": f"Импорт завершён",
        "added": added_count,
        "updated": updated_count
    }