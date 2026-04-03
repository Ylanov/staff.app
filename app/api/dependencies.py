# app/api/dependencies.py

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        raw_sub: str | None = payload.get("sub")
        if raw_sub is None:
            raise credentials_exception

        # БАГ-ФИКС: sub в JWT — строка, User.id — integer.
        # Раньше SQLAlchemy молча приводил тип, но crafted-токен с нечисловым sub
        # (например, sub="1 OR 1=1") мог вызвать неожиданное поведение.
        # Явный int() с перехватом ValueError закрывает этот вектор.
        try:
            user_id = int(raw_sub)
        except ValueError:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    # Проверяем что аккаунт активен — без этого деактивированные пользователи
    # продолжали работать до истечения токена
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Аккаунт деактивирован",
        )

    return user


def get_current_active_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав. Только для Админа.",
        )
    return current_user