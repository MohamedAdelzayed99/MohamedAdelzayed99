"""Turns domain events into in-app notifications and push messages (Observer)."""

from __future__ import annotations

from hightech.domain.enums import Program, WithdrawalStatus
from hightech.domain.events import EarningCancelled, EarningCreated, EventBus, OrderStatusChanged, WithdrawalDecided
from hightech.domain.money import format_egp
from hightech.infrastructure.gateways import PushSender
from hightech.infrastructure.models import Notification
from hightech.infrastructure.unit_of_work import UnitOfWorkFactory


class NotificationService:
    def __init__(self, uow_factory: UnitOfWorkFactory, push: PushSender):
        self._uow = uow_factory
        self._push = push

    def subscribe(self, bus: EventBus) -> None:
        bus.subscribe(EarningCreated, self._on_earning_created)
        bus.subscribe(EarningCancelled, self._on_earning_cancelled)
        bus.subscribe(OrderStatusChanged, self._on_order_status)
        bus.subscribe(WithdrawalDecided, self._on_withdrawal)

    # --- queries used by the apps
    def for_member(self, member_id: int) -> list[Notification]:
        with self._uow() as uow:
            return uow.notifications.for_member(member_id)

    def mark_all_read(self, member_id: int) -> None:
        with self._uow() as uow:
            uow.notifications.mark_all_read(member_id)
            uow.commit()

    # --- event handlers
    def _on_earning_created(self, e: EarningCreated) -> None:
        verb = "كسبت" if e.program is Program.RETAIL else "حصلت على خصم"
        self.notify(
            e.member_id,
            "ربح جديد 🎉",
            f"{verb} {format_egp(e.amount)} من طلب جديد في شبكتك (رصيد معلّق حتى انتهاء مدة الإرجاع)",
        )

    def _on_earning_cancelled(self, e: EarningCancelled) -> None:
        self.notify(
            e.member_id, "تم إلغاء ربح", f"تم إرجاع طلب في شبكتك، وتم إلغاء {format_egp(e.amount)} من رصيدك المعلّق"
        )

    def _on_order_status(self, e: OrderStatusChanged) -> None:
        self.notify(e.member_id, f"طلبك رقم {e.order_id}", f"حالة الطلب: {e.status.label_ar}")

    def _on_withdrawal(self, e: WithdrawalDecided) -> None:
        amount = format_egp(e.amount)
        message = {
            WithdrawalStatus.APPROVED: f"تمت الموافقة على سحب {amount}، وسيصلك قريبًا",
            WithdrawalStatus.PAID: f"تم تحويل {amount} إلى حسابك",
            WithdrawalStatus.REJECTED: f"تم رفض طلب سحب {amount} وعاد المبلغ لرصيدك"
            + (f": {e.note}" if e.note else ""),
        }.get(e.status)
        if message:
            self.notify(e.member_id, "طلب السحب", message)

    def notify(self, member_id: int, title: str, body: str) -> None:
        with self._uow() as uow:
            uow.notifications.add(Notification(member_id=member_id, title=title, body=body))
            token = uow.members.get(member_id).push_token
            uow.commit()
        if token:
            self._push.send(token, title, body)
