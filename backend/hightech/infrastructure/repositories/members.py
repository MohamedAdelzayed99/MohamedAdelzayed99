from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, func, or_, select, text

from hightech.domain.enums import MemberStatus, Program
from hightech.infrastructure.models import Member

from .base import SqlRepository


@dataclass(frozen=True)
class Descendant:
    depth: int
    member: Member


class MemberRepository(SqlRepository[Member]):
    model = Member

    def by_phone(self, program: Program, phone: str) -> Member | None:
        return self.session.scalar(select(Member).where(Member.program == program, Member.phone == phone))

    def by_referral_code(self, code: str) -> Member | None:
        return self.session.scalar(select(Member).where(Member.referral_code == code.upper()))

    def code_exists(self, code: str) -> bool:
        return self.session.scalar(select(func.count()).where(Member.referral_code == code)) > 0

    def upline_ids(self, member_id: int) -> list[int]:
        """Ancestors from the direct parent up to the root."""
        rows = self.session.execute(
            text(
                """
                WITH RECURSIVE up(id, parent_id, depth) AS (
                  SELECT id, parent_id, 0 FROM members WHERE id = :id
                  UNION ALL
                  SELECT m.id, m.parent_id, up.depth + 1 FROM members m JOIN up ON m.id = up.parent_id
                )
                SELECT id FROM up WHERE depth > 0 ORDER BY depth
                """
            ),
            {"id": member_id},
        )
        return [row.id for row in rows]

    def descendants(self, member_id: int, limit: int = 100_000) -> list[Descendant]:
        rows = self.session.execute(
            text(
                """
                WITH RECURSIVE down(id, depth) AS (
                  SELECT id, 0 FROM members WHERE id = :id
                  UNION ALL
                  SELECT m.id, down.depth + 1 FROM members m JOIN down ON m.parent_id = down.id
                )
                SELECT id, depth FROM down WHERE depth > 0 ORDER BY depth, id LIMIT :limit
                """
            ),
            {"id": member_id, "limit": limit},
        ).all()
        members = {m.id: m for m in self.session.scalars(select(Member).where(Member.id.in_([r.id for r in rows])))}
        return [Descendant(r.depth, members[r.id]) for r in rows]

    def direct_count(self, member_id: int) -> int:
        return self.session.scalar(select(func.count()).where(Member.parent_id == member_id))

    def search(self, program: str | None, status: str | None, query: str | None, phone: str | None) -> list[Member]:
        stmt = select(Member)
        if program:
            stmt = stmt.where(Member.program == program)
        if status:
            stmt = stmt.where(Member.status == status)
        if query:
            digits = "".join(ch for ch in query if ch.isdigit())
            conditions = [
                Member.name.contains(query),
                Member.shop_name.contains(query),
                Member.referral_code == query.upper(),
            ]
            if phone:
                conditions.append(Member.phone == phone)
            if digits:
                conditions.append(Member.phone.contains(digits))
            stmt = stmt.where(or_(*conditions))
        return list(self.session.scalars(stmt.order_by(Member.id.desc()).limit(100)))

    def count_by_program(self) -> list[dict]:
        rows = self.session.execute(
            select(
                Member.program,
                func.count().label("members"),
                func.sum(case((Member.status == MemberStatus.PENDING_APPROVAL, 1), else_=0)).label("pending"),
            ).group_by(Member.program)
        )
        return [{"program": r.program, "members": r.members, "pending": r.pending or 0} for r in rows]

    def touch(self, member: Member, when: datetime) -> None:
        member.last_active_at = when
