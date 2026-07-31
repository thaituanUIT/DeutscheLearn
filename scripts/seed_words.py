from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.services.words import seed_words


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_words(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
