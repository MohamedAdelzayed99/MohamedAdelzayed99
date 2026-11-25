from sqlalchemy import func, or_, select

from hightech.domain.order_state import CLOSED_WITHOUT_SALE
from hightech.infrastructure.models import Member, Order

from .base import SqlRepository


class OrderRepository(SqlRepository[Order]):
    model = Order

    def for_member(self, member_id: int) -> list[Order]:
        stmt = select(Order).where(Order.member_id == member_id).order_by(Order.id.desc()).limit(200)
        return list(self.session.scalars(stmt).unique())

    def search(self, program: str | None, status: str | None, query: str | None) -> list[Order]:
        stmt = select(Order).join(Member, Member.id == Order.member_id)
        if program:
            stmt = stmt.where(Order.program == program)
        if status:
            stmt = stmt.where(Order.status == status)
        if query:
            digits = "".join(ch for ch in query if ch.isdigit())
            conditions = [Member.name.contains(query)]
            if digits:
                conditions += [Member.phone.contains(digits)]
            if query.isdigit():
                conditions.append(Order.id == int(query))
            stmt = stmt.where(or_(*conditions))
        return list(self.session.scalars(stmt.order_by(Order.id.desc()).limit(200)).unique())

    def discount_used(self, member_id: int) -> int:
        stmt = select(func.coalesce(func.sum(Order.discount_used), 0)).where(
            Order.member_id == member_id, Order.status.not_in(list(CLOSED_WITHOUT_SALE))
        )
        return self.session.scalar(stmt)
