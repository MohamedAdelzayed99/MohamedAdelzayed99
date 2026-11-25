from typing import Generic, TypeVar

from sqlalchemy.orm import Session

from hightech.infrastructure.models import Base

T = TypeVar("T", bound=Base)


class SqlRepository(Generic[T]):
    model: type[T]

    def __init__(self, session: Session):
        self.session = session

    def get(self, entity_id: int) -> T | None:
        return self.session.get(self.model, entity_id)

    def add(self, entity: T) -> T:
        self.session.add(entity)
        self.session.flush()
        return entity
