from datetime import datetime

from sqlalchemy import func, select, update

from hightech.domain.enums import EarningStatus, OrderStatus, WithdrawalStatus
from hightech.infrastructure.models import Earning, Order, Withdrawal

from .base import SqlRepository


class EarningRepository(SqlRepository[Earning]):
    model = Earning

    def total(self, member_id: int, status: EarningStatus) -> int:
        stmt = select(func.coalesce(func.sum(Earning.amount), 0)).where(
            Earning.member_id == member_id, Earning.status == status
        )
        return self.session.scalar(stmt)

    def for_member(self, member_id: int, limit: int = 100) -> list[Earning]:
        stmt = select(Earning).where(Earning.member_id == member_id).order_by(Earning.id.desc()).limit(limit)
        return list(self.session.scalars(stmt))

    def for_order(self, order_id: int) -> list[Earning]:
        return list(self.session.scalars(select(Earning).where(Earning.order_id == order_id)))

    def totals_by_level(self, member_id: int) -> list[tuple[int, EarningStatus, int]]:
        stmt = (
            select(Earning.level, Earning.status, func.sum(Earning.amount))
            .where(Earning.member_id == member_id, Earning.status != EarningStatus.CANCELLED)
            .group_by(Earning.level, Earning.status)
        )
        return [(level, EarningStatus(status), total) for level, status, total in self.session.execute(stmt)]

    def release_matured(self, now: datetime) -> int:
        delivered = select(Order.id).where(Order.status == OrderStatus.DELIVERED)
        result = self.session.execute(
            update(Earning)
            .where(Earning.status == EarningStatus.PENDING, Earning.release_at <= now, Earning.order_id.in_(delivered))
            .values(status=EarningStatus.AVAILABLE)
        )
        return result.rowcount


class WithdrawalRepository(SqlRepository[Withdrawal]):
    model = Withdrawal

    def committed_total(self, member_id: int) -> int:
        """Money already taken out of the balance (everything except rejected requests)."""
        stmt = select(func.coalesce(func.sum(Withdrawal.amount), 0)).where(
            Withdrawal.member_id == member_id, Withdrawal.status != WithdrawalStatus.REJECTED
        )
        return self.session.scalar(stmt)

    def has_open_request(self, member_id: int) -> bool:
        stmt = select(func.count()).where(
            Withdrawal.member_id == member_id, Withdrawal.status == WithdrawalStatus.REQUESTED
        )
        return self.session.scalar(stmt) > 0

    def for_member(self, member_id: int, limit: int = 50) -> list[Withdrawal]:
        stmt = select(Withdrawal).where(Withdrawal.member_id == member_id).order_by(Withdrawal.id.desc()).limit(limit)
        return list(self.session.scalars(stmt))

    def list(self, status: str | None) -> list[Withdrawal]:
        stmt = select(Withdrawal)
        if status:
            stmt = stmt.where(Withdrawal.status == status)
        return list(self.session.scalars(stmt.order_by(Withdrawal.id.desc()).limit(300)))
