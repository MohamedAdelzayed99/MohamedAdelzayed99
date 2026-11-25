from __future__ import annotations

from dataclasses import dataclass, field

from hightech.domain.enums import EarningStatus, MemberStatus, Program
from hightech.domain.errors import NotFoundError, ValidationError
from hightech.domain.phone import normalize_phone
from hightech.infrastructure.models import Member
from hightech.infrastructure.security import referral_code
from hightech.infrastructure.unit_of_work import UnitOfWork, UnitOfWorkFactory

from .settings_service import load_settings


@dataclass
class NetworkLevel:
    level: int
    count: int = 0
    earned_available: int = 0
    earned_pending: int = 0
    members: list[Member] | None = None


@dataclass
class NetworkView:
    total_members: int
    levels: list[NetworkLevel]
    all_members: list[tuple[int, Member]] = field(default_factory=list)  # (depth, member), admin only


def build_network(uow: UnitOfWork, member: Member, names_depth: int, include_all: bool = False) -> NetworkView:
    """Counts and earnings per level; names only down to `names_depth` (privacy, plan Q10)."""
    descendants = uow.members.descendants(member.id, limit=100_000)
    levels: dict[int, NetworkLevel] = {}

    def level(n: int) -> NetworkLevel:
        return levels.setdefault(n, NetworkLevel(n))

    for d in descendants:
        entry = level(d.depth)
        entry.count += 1
        if d.depth <= names_depth:
            entry.members = (entry.members or []) + [d.member]
    for lvl, status, total in uow.earnings.totals_by_level(member.id):
        if status is EarningStatus.AVAILABLE:
            level(lvl).earned_available += total
        else:
            level(lvl).earned_pending += total
    return NetworkView(
        total_members=len(descendants),
        levels=sorted(levels.values(), key=lambda x: x.level),
        all_members=[(d.depth, d.member) for d in descendants[:2000]] if include_all else [],
    )


class NetworkService:
    def __init__(self, uow_factory: UnitOfWorkFactory):
        self._uow = uow_factory

    def for_member(self, member_id: int) -> NetworkView:
        with self._uow() as uow:
            member = uow.members.get(member_id)
            return build_network(uow, member, load_settings(uow).network_names_depth)

    def referrer_name(self, program: Program, code: str) -> str:
        with self._uow() as uow:
            member = uow.members.by_referral_code(code)
            if member is None or member.program != program:
                raise NotFoundError("كود الدعوة غير صحيح")
            return member.display_name

    def update_profile(
        self, member_id: int, name: str | None = None, push_token: str | None = None, clear_push: bool = False
    ) -> Member:
        with self._uow() as uow:
            member = uow.members.get(member_id)
            if name is not None:
                name = name.strip()
                if not name or len(name) > 80:
                    raise ValidationError("invalid_name", "قيمة غير صحيحة: name")
                member.name = name
            if push_token is not None or clear_push:
                member.push_token = (push_token or "")[:200] or None
            uow.commit()
            return member


class MemberAdminService:
    """Dashboard operations on accounts. Every change is written to the audit log."""

    def __init__(self, uow_factory: UnitOfWorkFactory):
        self._uow = uow_factory

    def search(self, program: str | None, status: str | None, query: str | None) -> list[tuple[Member, int]]:
        phone = None
        if query:
            try:
                phone = normalize_phone(query)
            except ValidationError:
                phone = None
        with self._uow() as uow:
            return [(m, uow.members.direct_count(m.id)) for m in uow.members.search(program, status, query, phone)]

    def upline(self, member_id: int) -> list[Member]:
        with self._uow() as uow:
            return [uow.members.get(i) for i in uow.members.upline_ids(member_id)]

    def get(self, member_id: int) -> Member:
        with self._uow() as uow:
            member = uow.members.get(member_id)
            if member is None:
                raise NotFoundError("العضو غير موجود")
            return member

    def full_network(self, member_id: int) -> NetworkView:
        with self._uow() as uow:
            member = uow.members.get(member_id)
            return build_network(uow, member, load_settings(uow).network_names_depth, include_all=True)

    def set_status(self, admin_id: int, member_id: int, status: str) -> None:
        try:
            new_status = MemberStatus(status)
        except ValueError:
            raise ValidationError("status", "حالة غير صحيحة") from None
        with self._uow() as uow:
            member = uow.members.get(member_id)
            if member is None:
                raise NotFoundError("العضو غير موجود")
            member.status = new_status
            if new_status is MemberStatus.SUSPENDED:
                uow.sessions.revoke_all("member", member_id)
            uow.audit.record(admin_id, "member_status", "member", member_id, {"status": new_status})
            uow.commit()

    def move(self, admin_id: int, member_id: int, new_parent_id: int | None, reason: str) -> None:
        """Change someone's place in the tree. Refuses cross-program moves and cycles."""
        with self._uow() as uow:
            member = uow.members.get(member_id)
            if member is None:
                raise NotFoundError("العضو غير موجود")
            if new_parent_id is not None:
                parent = uow.members.get(new_parent_id)
                if parent is None:
                    raise NotFoundError("العضو الجديد غير موجود")
                if parent.program != member.program:
                    raise ValidationError("program_mismatch", "لا يمكن النقل بين القطاعي والجملة")
                if parent.id == member.id or member.id in uow.members.upline_ids(parent.id):
                    raise ValidationError("cycle", "لا يمكن وضع العضو تحت أحد أفراد شبكته")
            old_parent = member.parent_id
            member.parent_id = new_parent_id
            uow.audit.record(
                admin_id,
                "move_member",
                "member",
                member_id,
                {"from": old_parent, "to": new_parent_id, "reason": reason},
            )
            uow.commit()

    def create(
        self,
        admin_id: int,
        program: Program,
        phone: str,
        name: str,
        parent_id: int | None,
        shop_name: str | None,
        shop_address: str | None,
    ) -> Member:
        """Company-registered members, e.g. the names at the top of the sheets (م. خالد, ميلانو...)."""
        with self._uow() as uow:
            if parent_id is not None:
                parent = uow.members.get(parent_id)
                if parent is None or parent.program != program:
                    raise ValidationError("parent", "العضو الأعلى غير صحيح")
            if uow.members.by_phone(program, phone):
                raise ValidationError("phone_taken", "الرقم مسجل بالفعل")
            code = referral_code(program.code_prefix)
            while uow.members.code_exists(code):
                code = referral_code(program.code_prefix)
            member = uow.members.add(
                Member(
                    program=program,
                    phone=phone,
                    name=name,
                    referral_code=code,
                    parent_id=parent_id,
                    status=MemberStatus.ACTIVE,
                    shop_name=shop_name or None,
                    shop_address=shop_address or None,
                )
            )
            uow.audit.record(
                admin_id, "create_member", "member", member.id, {"program": program, "parent_id": parent_id}
            )
            uow.commit()
            return member
