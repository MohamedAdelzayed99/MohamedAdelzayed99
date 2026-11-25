from datetime import datetime

from sqlalchemy import delete, select

from hightech.infrastructure.models import Admin, AuthSession, OtpCode

from .base import SqlRepository


class OtpRepository:
    def __init__(self, session):
        self.session = session

    def get(self, program: str, phone: str) -> OtpCode | None:
        return self.session.get(OtpCode, (program, phone))

    def save(self, otp: OtpCode) -> None:
        self.session.merge(otp)

    def delete(self, program: str, phone: str) -> None:
        self.session.execute(delete(OtpCode).where(OtpCode.program == program, OtpCode.phone == phone))


class SessionRepository:
    def __init__(self, session):
        self.session = session

    def create(self, token_hash: str, kind: str, subject_id: int, expires_at: datetime) -> None:
        self.session.add(AuthSession(token_hash=token_hash, kind=kind, subject_id=subject_id, expires_at=expires_at))

    def subject(self, token_hash: str, kind: str, now: datetime) -> int | None:
        stmt = select(AuthSession.subject_id).where(
            AuthSession.token_hash == token_hash, AuthSession.kind == kind, AuthSession.expires_at > now
        )
        return self.session.scalar(stmt)

    def revoke(self, token_hash: str) -> None:
        self.session.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash))

    def revoke_all(self, kind: str, subject_id: int) -> None:
        self.session.execute(delete(AuthSession).where(AuthSession.kind == kind, AuthSession.subject_id == subject_id))


class AdminRepository(SqlRepository[Admin]):
    model = Admin

    def by_username(self, username: str) -> Admin | None:
        return self.session.scalar(select(Admin).where(Admin.username == username))

    def any(self) -> bool:
        return self.session.scalar(select(Admin.id).limit(1)) is not None
