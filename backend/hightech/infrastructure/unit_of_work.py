"""Unit of Work: one database transaction per use case, plus the domain events it raised.

Events are published only after a successful commit, so subscribers (notifications,
push) never react to work that was rolled back.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.orm import Session, sessionmaker

from hightech.domain.events import DomainEvent, EventBus

from . import repositories as r


class UnitOfWork:
    def __init__(self, session_factory: sessionmaker, bus: EventBus):
        self._session_factory = session_factory
        self._bus = bus
        self._events: list[DomainEvent] = []
        self.session: Session

    def __enter__(self) -> UnitOfWork:
        self.session = self._session_factory()
        s = self.session
        self.members = r.MemberRepository(s)
        self.categories = r.CategoryRepository(s)
        self.products = r.ProductRepository(s)
        self.orders = r.OrderRepository(s)
        self.earnings = r.EarningRepository(s)
        self.withdrawals = r.WithdrawalRepository(s)
        self.settings = r.SettingsRepository(s)
        self.rates = r.RateRepository(s)
        self.otps = r.OtpRepository(s)
        self.sessions = r.SessionRepository(s)
        self.admins = r.AdminRepository(s)
        self.notifications = r.NotificationRepository(s)
        self.audit = r.AuditRepository(s)
        self.reports = r.ReportRepository(s)
        return self

    def __exit__(self, exc_type, *_):
        try:
            if exc_type is not None:
                self.session.rollback()
        finally:
            self.session.close()
        if exc_type is None:
            # Events of a committed (or read-only) unit are published after the session is closed.
            events, self._events = self._events, []
            for event in events:
                self._bus.publish(event)

    def collect(self, event: DomainEvent) -> None:
        self._events.append(event)

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
        self._events.clear()


UnitOfWorkFactory = Callable[[], UnitOfWork]
