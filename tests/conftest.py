import os
from pathlib import Path

TEST_DATABASE_PATH = Path("/tmp/recognition-pytest.db")

TEST_DATABASE_PATH.unlink(missing_ok=True)

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DATABASE_PATH}"
os.environ["ENVIRONMENT"] = "development"
os.environ.pop("ADMIN_TOKEN", None)
os.environ.pop("ADMIN_KEY", None)


def pytest_configure() -> None:
    from app.db.models import Base
    from app.db.session import engine

    Base.metadata.create_all(bind=engine)
