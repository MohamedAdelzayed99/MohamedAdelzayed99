import json
from datetime import datetime

from sqlalchemy import select, text, update

from hightech.infrastructure.models import AuditLog, Notification

from .base import SqlRepository


class NotificationRepository(SqlRepository[Notification]):
    model = Notification

    def for_member(self, member_id: int) -> list[Notification]:
        stmt = (
            select(Notification).where(Notification.member_id == member_id).order_by(Notification.id.desc()).limit(100)
        )
        return list(self.session.scalars(stmt))

    def mark_all_read(self, member_id: int) -> None:
        self.session.execute(update(Notification).where(Notification.member_id == member_id).values(read=True))


class AuditRepository(SqlRepository[AuditLog]):
    model = AuditLog

    def record(self, admin_id: int | None, action: str, entity: str, entity_id: int | None, details: dict) -> None:
        self.add(
            AuditLog(
                admin_id=admin_id,
                action=action,
                entity=entity,
                entity_id=entity_id,
                details=json.dumps(details, ensure_ascii=False, default=str),
            )
        )

    def recent(self, limit: int = 300) -> list[AuditLog]:
        return list(self.session.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)))


class ReportRepository:
    """Read-only aggregate queries for the dashboard (kept apart from the write-side repositories)."""

    def __init__(self, session):
        self.session = session

    def _rows(self, sql: str, **params) -> list[dict]:
        # Raw SQL gets datetimes as text in the same format SQLAlchemy stores them in.
        bound = {k: v.isoformat(" ") if isinstance(v, datetime) else v for k, v in params.items()}
        return [dict(row._mapping) for row in self.session.execute(text(sql), bound)]

    def sales(self, start: datetime, end: datetime) -> list[dict]:
        return self._rows(
            """SELECT program, COUNT(*) AS orders, SUM(subtotal) AS revenue FROM orders
               WHERE status = 'delivered' AND delivered_at BETWEEN :s AND :e GROUP BY program""",
            s=start,
            e=end,
        )

    def daily(self, start: datetime, end: datetime) -> list[dict]:
        return self._rows(
            """SELECT date(delivered_at) AS day, program, SUM(subtotal) AS revenue, COUNT(*) AS orders FROM orders
               WHERE status = 'delivered' AND delivered_at BETWEEN :s AND :e GROUP BY day, program ORDER BY day""",
            s=start,
            e=end,
        )

    def commissions(self, start: datetime, end: datetime) -> list[dict]:
        return self._rows(
            """SELECT program, status, SUM(amount) AS total FROM earnings
               WHERE created_at BETWEEN :s AND :e GROUP BY program, status""",
            s=start,
            e=end,
        )

    def payable(self) -> dict:
        return self._rows(
            """SELECT
                 (SELECT COALESCE(SUM(amount), 0) FROM earnings
                   WHERE program = 'retail' AND status = 'available')
                 - (SELECT COALESCE(SUM(amount), 0) FROM withdrawals
                   WHERE status != 'rejected') AS retail_available_unpaid,
                 (SELECT COALESCE(SUM(amount), 0) FROM withdrawals
                   WHERE status IN ('requested', 'approved')) AS withdrawals_open"""
        )[0]

    def top_networks(self, start: datetime, end: datetime) -> list[dict]:
        return self._rows(
            """SELECT m.id, m.program, COALESCE(m.shop_name, m.name) AS name, m.phone,
                      SUM(e.amount) AS earned, COUNT(DISTINCT e.order_id) AS orders
               FROM earnings e JOIN members m ON m.id = e.member_id
               WHERE e.status != 'cancelled' AND e.created_at BETWEEN :s AND :e
               GROUP BY m.id ORDER BY earned DESC LIMIT 20""",
            s=start,
            e=end,
        )

    def open_orders(self) -> list[dict]:
        return self._rows(
            "SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('placed','confirmed','shipped') GROUP BY status"
        )
