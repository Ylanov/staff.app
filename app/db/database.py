from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Импортируем наши настройки (логины, пароли, хост) из config.py
from app.core.config import settings

# Получаем строку подключения к базе данных из настроек
# Внутри докера она будет выглядеть так: postgresql://admin:localpassword@db:5432/staff_db
SQLALCHEMY_DATABASE_URL = settings.DATABASE_URI

# Создаем "движок" (engine) — главную точку входа для SQLAlchemy
# Если хочешь видеть в консоли все SQL-запросы, которые генерирует питон, поставь echo=True
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    echo=False
)

# Создаем фабрику сессий (каждый запрос к API будет создавать новую сессию из этой фабрики)
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Базовый класс, от которого будут наследоваться все наши таблицы (User, Event, Slot и т.д.)
Base = declarative_base()

# Главная функция-зависимость (Dependency) для FastAPI
# Она открывает соединение с БД в начале запроса и ГАРАНТИРОВАННО закрывает его в конце
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()