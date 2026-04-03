# app/core/config.py

import secrets
from pydantic_settings import BaseSettings
from pydantic import model_validator


class Settings(BaseSettings):
    PROJECT_NAME: str = "Staff Platform"
    ENV: str = "development"  # "development" | "production"

    POSTGRES_USER: str = "admin"
    POSTGRES_PASSWORD: str = "localpassword"
    POSTGRES_DB: str = "staff_db"
    POSTGRES_SERVER: str = "db"
    POSTGRES_PORT: str = "5432"

    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    # БАГ-ФИКС: поля ORG_NAME, DUTY_TITLE, DUTY_RANK, DUTY_NAME удалены.
    # Они дублировали таблицу settings в БД и нигде не использовались —
    # export.py читает эти значения через get_setting(db, key), не из config.
    # Хранить изменяемые runtime-данные в переменных окружения неудобно:
    # требует перезапуска контейнера. Таблица settings решает это правильно.

    # Пароль для авто-создания суперпользователя при первом запуске.
    # Если не задан — генерируется случайный и выводится в лог.
    ADMIN_PASSWORD: str = ""
    RESET_ADMIN_PASSWORD: bool = False

    # CORS: список разрешённых origins через запятую.
    # Пример в .env: ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
    # В dev можно оставить "*", но тогда allow_credentials должен быть False.
    ALLOWED_ORIGINS: str = "*"

    @property
    def DATABASE_URI(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:"
            f"{self.POSTGRES_PASSWORD}@"
            f"{self.POSTGRES_SERVER}:"
            f"{self.POSTGRES_PORT}/"
            f"{self.POSTGRES_DB}"
        )

    @property
    def cors_origins(self) -> list[str]:
        """Разбирает ALLOWED_ORIGINS в список. Возвращает ["*"] если не задан."""
        if not self.ALLOWED_ORIGINS or self.ALLOWED_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def cors_allow_credentials(self) -> bool:
        """
        allow_credentials=True несовместим с allow_origins=["*"] по спецификации CORS —
        браузер отклоняет такие ответы. Включаем credentials только если заданы явные origins.
        """
        return self.cors_origins != ["*"]

    # ─── Валидация при старте ─────────────────────────────────────────────────

    @model_validator(mode="after")
    def validate_secret_key(self) -> "Settings":
        """
        В production дефолтный SECRET_KEY недопустим — любой может подделать JWT.
        Приложение не стартует пока ключ не заменён на случайный.
        Сгенерировать: python -c "import secrets; print(secrets.token_hex(32))"
        """
        if self.ENV == "production" and self.SECRET_KEY == "change-me":
            raise ValueError(
                "SECRET_KEY не может быть 'change-me' в production. "
                "Задайте переменную окружения SECRET_KEY."
            )
        return self

    model_config = {
        "env_file": ".env",
        # БАГ-ФИКс: переменные из .env которых нет в модели (например org_name,
        # duty_title, duty_rank, duty_name оставшиеся от старой конфигурации)
        # теперь молча игнорируются вместо ValidationError.
        "extra": "ignore",
    }


settings = Settings()