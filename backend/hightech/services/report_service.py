from __future__ import annotations

from datetime import date, datetime, time

from hightech.domain.errors import ValidationError
from hightech.infrastructure.models import AuditLog
from hightech.infrastructure.unit_of_work import UnitOfWorkFactory


class ReportService:
    def __init__(self, uow_factory: UnitOfWorkFactory):
        self._uow = uow_factory

    def dashboard(self, start: str | None, end: str | None) -> dict:
        since = _parse_day(start, time.min) or datetime(1970, 1, 1)
        until = _parse_day(end, time.max) or datetime(9999, 12, 31)
        with self._uow() as uow:
            reports = uow.reports
            return {
                "sales": reports.sales(since, until),
                "daily": reports.daily(since, until),
                "commissions": reports.commissions(since, until),
                "payable": reports.payable(),
                "topNetworks": reports.top_networks(since, until),
                "counts": uow.members.count_by_program(),
                "openOrders": reports.open_orders(),
            }

    def audit_log(self) -> list[AuditLog]:
        with self._uow() as uow:
            return uow.audit.recent()


def _parse_day(value: str | None, at: time) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.combine(date.fromisoformat(value), at)
    except ValueError:
        raise ValidationError("invalid_date", "تاريخ غير صحيح") from None
