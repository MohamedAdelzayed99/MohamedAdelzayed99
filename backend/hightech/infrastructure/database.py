from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .models import Base


def create_db_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        in_memory = url in ("sqlite://", "sqlite:///:memory:")
        engine = create_engine(
            url,
            connect_args={"check_same_thread": False},
            **({"poolclass": StaticPool} if in_memory else {}),
        )

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover - trivial
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys = ON")
            if not in_memory:
                cursor.execute("PRAGMA journal_mode = WAL")
            cursor.close()
            # Let SQLAlchemy own transactions so we can take the write lock up front (below).
            dbapi_connection.isolation_level = None

        @event.listens_for(engine, "begin")
        def _begin_immediate(connection):  # pragma: no cover - trivial
            # Serialise writers: balance checks and stock updates can't race each other.
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    else:
        engine = create_engine(url, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    return engine


def create_session_factory(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, expire_on_commit=False)
