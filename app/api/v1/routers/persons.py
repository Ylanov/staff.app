# app/api/v1/routers/persons.py

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional

from app.db.database import get_db
from app.models.person import Person
from app.models.user import User
from app.api.dependencies import get_current_user, get_current_active_admin
import io
from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
import openpyxl

router = APIRouter()


# ─── Схемы ────────────────────────────────────────────────────────────────────

class PersonCreate(BaseModel):
    full_name:  str           = Field(..., min_length=2, max_length=300, strip_whitespace=True)
    rank:       Optional[str] = Field(None, max_length=100, strip_whitespace=True)
    doc_number: Optional[str] = Field(None, max_length=100, strip_whitespace=True)


class PersonUpdate(BaseModel):
    full_name:  Optional[str] = Field(None, min_length=2, max_length=300, strip_whitespace=True)
    rank:       Optional[str] = Field(None, max_length=100, strip_whitespace=True)
    doc_number: Optional[str] = Field(None, max_length=100, strip_whitespace=True)


class PersonResponse(BaseModel):
    id:         int
    full_name:  str
    rank:       Optional[str] = None
    doc_number: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Поиск (доступен всем авторизованным пользователям) ──────────────────────

@router.get(
    "/search",
    response_model=List[PersonResponse],
    summary="Поиск человека по ФИО (для автодополнения)",
)
def search_persons(
        q:            str     = Query(..., min_length=2, description="Часть ФИО для поиска"),
        limit:        int     = Query(10, ge=1, le=50),
        db:           Session = Depends(get_db),
        current_user: User    = Depends(get_current_user),
):
    """
    Возвращает людей чьё ФИО содержит строку q.
    Используется для автодополнения в полях ввода.
    Минимум 2 символа чтобы не грузить БД пустыми запросами.
    """
    return (
        db.query(Person)
        .filter(Person.full_name.ilike(f"%{q}%"))
        .order_by(Person.full_name)
        .limit(limit)
        .all()
    )


# ─── CRUD (только администратор) ──────────────────────────────────────────────

@router.get(
    "",
    response_model=List[PersonResponse],
    summary="Получить всю базу людей",
)
def get_all_persons(
        db:            Session = Depends(get_db),
        current_admin: User    = Depends(get_current_active_admin),
        skip:          int     = Query(0, ge=0),
        limit:         int     = Query(200, ge=1, le=1000),
        q:             Optional[str] = Query(None, description="Фильтр по ФИО"),
):
    query = db.query(Person)
    if q:
        query = query.filter(Person.full_name.ilike(f"%{q}%"))
    return query.order_by(Person.full_name).offset(skip).limit(limit).all()


@router.post(
    "",
    response_model=PersonResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить человека вручную",
)
def create_person(
        person_in:     PersonCreate,
        db:            Session = Depends(get_db),
        current_admin: User    = Depends(get_current_active_admin),
):
    existing = (
        db.query(Person)
        .filter(Person.full_name.ilike(person_in.full_name))
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Человек с таким ФИО уже есть в базе",
        )

    person = Person(
        full_name=person_in.full_name,
        rank=person_in.rank or None,
        doc_number=person_in.doc_number or None,
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
        person_id:     int,
        person_in:     PersonUpdate,
        db:            Session = Depends(get_db),
        current_admin: User    = Depends(get_current_active_admin),
):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Человек не найден")

    update_data = person_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(person, key, value if value != "" else None)

    db.commit()
    db.refresh(person)
    return person


@router.delete(
    "/{person_id}",
    summary="Удалить человека из базы",
)
def delete_person(
        person_id:     int,
        db:            Session = Depends(get_db),
        current_admin: User    = Depends(get_current_active_admin),
):
    person = db.query(Person).filter(Person.id == person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Человек не найден")

    db.delete(person)
    db.commit()
    return {"message": "Удалён из базы"}


# ─── Внутренняя функция: upsert при заполнении слота ─────────────────────────

def upsert_person_from_slot(db: Session, full_name: str, rank: str = None, doc_number: str = None) -> None:
    """
    Вызывается из slots.py при сохранении данных пользователем.
    Если человек уже есть в базе — обновляет его данные (если они стали полнее).
    Если нет — создаёт новую запись.

    Логика обновления: перезаписываем только если новое значение не пустое.
    Это предотвращает затирание данных если пользователь частично заполнил поля.

    БАГ-ФИКС: добавлена обработка IntegrityError для защиты от race condition.
    При одновременном сохранении двух слотов с одинаковым ФИО второй INSERT
    нарушит уникальный индекс на full_name — перехватываем и откатываемся.
    commit() делает вызывающая сторона (slots.py), поэтому здесь используем flush().
    """
    if not full_name or not full_name.strip():
        return

    full_name = full_name.strip()

    existing = (
        db.query(Person)
        .filter(Person.full_name.ilike(full_name))
        .first()
    )

    if existing:
        if rank and rank.strip():
            existing.rank = rank.strip()
        if doc_number and doc_number.strip():
            existing.doc_number = doc_number.strip()
    else:
        person = Person(
            full_name=full_name,
            rank=rank.strip() if rank and rank.strip() else None,
            doc_number=doc_number.strip() if doc_number and doc_number.strip() else None,
        )
        db.add(person)
        try:
            # flush() проверяет уникальность ещё до commit() вызывающей стороны
            db.flush()
        except IntegrityError:
            # Другой запрос успел создать запись — откатываем только этот flush,
            # основная транзакция (обновление слота) продолжается.
            db.rollback()


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

    # Выгружаем текущую базу в словарь для быстрого O(1) поиска (чтобы не делать 5000 SELECT'ов)
    existing_records = {p.full_name.lower(): p for p in db.query(Person).all()}

    new_persons = []
    updated_count = 0
    added_count = 0

    # Читаем Excel (начиная со 2-й строки, игнорируя заголовки)
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue

        full_name = str(row[0]).strip()
        if not full_name or len(full_name) < 2:
            continue

        rank = str(row[1]).strip() if len(row) > 1 and row[1] is not None else None
        doc = str(row[2]).strip() if len(row) > 2 and row[2] is not None else None

        # Очищаем пустые строки
        if rank == "None" or not rank: rank = None
        if doc == "None" or not doc: doc = None

        existing_person = existing_records.get(full_name.lower())

        if existing_person:
            # Обновляем данные, только если в Excel есть новые значения
            changed = False
            if rank and existing_person.rank != rank:
                existing_person.rank = rank
                changed = True
            if doc and existing_person.doc_number != doc:
                existing_person.doc_number = doc
                changed = True

            if changed:
                updated_count += 1
        else:
            # Создаем нового
            new_p = Person(full_name=full_name, rank=rank, doc_number=doc)
            new_persons.append(new_p)
            # Добавляем в словарь, чтобы избежать дублей внутри самого Excel-файла
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