# app/api/v1/routers/auth.py

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.user import User
from app.core.security import verify_password, create_access_token
from app.schemas.token import Token
from app.api.dependencies import get_current_user

router = APIRouter()


@router.post("/login", response_model=Token, summary="Получить JWT-токен")
def login_access_token(
    db: Session = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    user = db.query(User).filter(User.username == form_data.username).first()

    # БАГ-ФИКС: статус 400 заменён на 401 — это стандарт OAuth2 / RFC 6750.
    # Фронтенд и сторонние клиенты ожидают именно 401 при неверных credentials.
    # Заголовок WWW-Authenticate обязателен при 401 по спецификации HTTP.
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Намеренно не проверяем is_active здесь — деактивированный пользователь
    # получит токен, но get_current_user в dependencies.py отклонит каждый запрос.
    # Это стандартная практика: не раскрывать причину отказа на этапе логина.

    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
    }


@router.get("/me", response_model=dict, summary="Получить данные текущего пользователя")
def read_users_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
    }