from __future__ import annotations

from dataclasses import dataclass

from hightech.domain.enums import EarningStatus, Program, WithdrawalStatus
from hightech.domain.errors import NotFoundError, PermissionDenied, ValidationError
from hightech.domain.events import WithdrawalDecided
from hightech.domain.money import format_egp
from hightech.infrastructure.clock import Clock
from hightech.infrastructure.models import Earning, Member, Withdrawal
from hightech.infrastructure.unit_of_work import UnitOfWork, UnitOfWorkFactory

from .settings_service import load_settings


@dataclass(frozen=True)
class Balances:
    """Always derived from the ledger, never stored, so no phone can edit a balance (plan section 6).

    available = released earnings − withdrawals (not rejected) − discount used on open invoices
    """

    available: int
    pending: int
    withdrawn: int
    used_on_invoices: int
    lifetime: int


def compute_balances(uow: UnitOfWork, member_id: int) -> Balances:
    released = uow.earnings.total(member_id, EarningStatus.AVAILABLE)
    pending = uow.earnings.total(member_id, EarningStatus.PENDING)
    withdrawn = uow.withdrawals.committed_total(member_id)
    used = uow.orders.discount_used(member_id)
    return Balances(released - withdrawn - used, pending, withdrawn, used, released + pending)


@dataclass(frozen=True)
class WalletView:
    balances: Balances
    min_withdrawal: int
    can_withdraw: bool
    withdrawal_methods: list[str]
    earnings: list[Earning]
    withdrawals: list[Withdrawal]


# Allowed withdrawal decisions: requested → approved | rejected, approved → paid | rejected
_WITHDRAWAL_FLOW = {
    WithdrawalStatus.REQUESTED: {WithdrawalStatus.APPROVED, WithdrawalStatus.REJECTED},
    WithdrawalStatus.APPROVED: {WithdrawalStatus.PAID, WithdrawalStatus.REJECTED},
}


class WalletService:
    def __init__(self, uow_factory: UnitOfWorkFactory, clock: Clock):
        self._uow = uow_factory
        self._clock = clock

    def balances(self, member_id: int) -> Balances:
        with self._uow() as uow:
            return compute_balances(uow, member_id)

    def view(self, member: Member) -> WalletView:
        with self._uow() as uow:
            settings = load_settings(uow)
            return WalletView(
                balances=compute_balances(uow, member.id),
                min_withdrawal=settings.min_withdrawal,
                can_withdraw=settings.can_cash_out(Program(member.program)),
                withdrawal_methods=settings.withdrawal_methods,
                earnings=uow.earnings.for_member(member.id),
                withdrawals=uow.withdrawals.for_member(member.id),
            )

    def request_withdrawal(self, member: Member, amount: int, method: str, account: str) -> Withdrawal:
        with self._uow() as uow:
            settings = load_settings(uow)
            if not settings.can_cash_out(Program(member.program)):
                raise PermissionDenied("رصيد الخصم يُستخدم في الفواتير القادمة فقط")
            if method not in settings.withdrawal_methods:
                raise ValidationError("method", "طريقة السحب غير متاحة")
            if amount < settings.min_withdrawal:
                raise ValidationError("below_min", f"الحد الأدنى للسحب {format_egp(settings.min_withdrawal)}")
            if uow.withdrawals.has_open_request(member.id):
                raise ValidationError("pending_exists", "لديك طلب سحب قيد المراجعة بالفعل")
            if amount > compute_balances(uow, member.id).available:
                raise ValidationError("insufficient", "الرصيد المتاح لا يكفي")
            withdrawal = uow.withdrawals.add(
                Withdrawal(
                    member_id=member.id, amount=amount, method=method, account=account, created_at=self._clock.now()
                )
            )
            stored = uow.members.get(member.id)
            stored.payout_method, stored.payout_account = method, account
            uow.commit()
            return withdrawal

    def decide(self, admin_id: int, withdrawal_id: int, status: str, note: str = "") -> Withdrawal:
        """Dashboard decision. A rejection returns the money to the available balance automatically."""
        try:
            target = WithdrawalStatus(status)
        except ValueError:
            raise ValidationError("bad_transition", "لا يمكن تغيير حالة هذا الطلب") from None
        with self._uow() as uow:
            withdrawal = uow.withdrawals.get(withdrawal_id)
            if withdrawal is None:
                raise NotFoundError("طلب السحب غير موجود")
            if target not in _WITHDRAWAL_FLOW.get(WithdrawalStatus(withdrawal.status), set()):
                raise ValidationError("bad_transition", "لا يمكن تغيير حالة هذا الطلب")
            withdrawal.status = target
            withdrawal.note = note
            withdrawal.decided_at = self._clock.now()
            withdrawal.decided_by = admin_id
            uow.audit.record(
                admin_id,
                f"withdrawal_{target}",
                "withdrawal",
                withdrawal_id,
                {"amount": withdrawal.amount, "note": note},
            )
            uow.collect(WithdrawalDecided(withdrawal.member_id, withdrawal.amount, target, note))
            uow.commit()
            return withdrawal

    def list(self, status: str | None) -> list[Withdrawal]:
        with self._uow() as uow:
            return uow.withdrawals.list(status)
