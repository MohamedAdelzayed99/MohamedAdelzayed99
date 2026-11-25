from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from hightech.domain.commission import CommissionPolicy
from hightech.domain.enums import EarningStatus, MemberStatus, OrderStatus, PaymentStatus, Program
from hightech.domain.errors import NotFoundError, PermissionDenied, ValidationError
from hightech.domain.events import EarningCancelled, EarningCreated, OrderStatusChanged
from hightech.domain.order_state import ensure_transition
from hightech.infrastructure.clock import Clock
from hightech.infrastructure.models import Earning, Member, Order, OrderItem, OrderStatusLog
from hightech.infrastructure.unit_of_work import UnitOfWork, UnitOfWorkFactory

from .settings_service import load_settings
from .wallet_service import compute_balances

MAX_CART_LINES = 100
CASH_ON_DELIVERY = "cod"


@dataclass(frozen=True)
class CartLine:
    product_id: int
    qty: int


@dataclass(frozen=True)
class Checkout:
    lines: list[CartLine]
    address: str
    governorate: str = ""
    contact_phone: str | None = None
    notes: str = ""
    payment_method: str = CASH_ON_DELIVERY
    use_discount: bool = False  # wholesale: spend the discount balance on this invoice


class OrderService:
    def __init__(self, uow_factory: UnitOfWorkFactory, clock: Clock):
        self._uow = uow_factory
        self._clock = clock

    # ------------------------------------------------------------------ member side
    def place(self, member: Member, checkout: Checkout) -> Order:
        if member.status != MemberStatus.ACTIVE:
            raise PermissionDenied("الحساب في انتظار التفعيل")
        if not checkout.lines or len(checkout.lines) > MAX_CART_LINES:
            raise ValidationError("empty_cart", "السلة فارغة")
        program = Program(member.program)
        with self._uow() as uow:
            settings = load_settings(uow)
            if checkout.payment_method not in settings.payment_methods(program):
                raise ValidationError("payment_method", "طريقة الدفع غير متاحة")
            items = [self._reserve(uow, program, line) for line in checkout.lines]
            subtotal = sum(item.unit_price * item.qty for item in items)
            discount = (
                min(compute_balances(uow, member.id).available, subtotal)
                if program is Program.WHOLESALE and checkout.use_discount
                else 0
            )
            discount = max(discount, 0)
            shipping = settings.shipping_fee(program)
            now = self._clock.now()
            order = uow.orders.add(
                Order(
                    program=program,
                    member_id=member.id,
                    payment_method=checkout.payment_method,
                    subtotal=subtotal,
                    discount_used=discount,
                    shipping_fee=shipping,
                    total=subtotal - discount + shipping,
                    address=checkout.address,
                    governorate=checkout.governorate,
                    contact_phone=checkout.contact_phone or member.phone,
                    notes=checkout.notes,
                    rate_version_id=uow.rates.current(program).id,
                    created_at=now,
                    items=items,
                    history=[OrderStatusLog(status=OrderStatus.PLACED, at=now)],
                )
            )
            uow.members.touch(uow.members.get(member.id), now)
            uow.commit()
            return order

    def _reserve(self, uow: UnitOfWork, program: Program, line: CartLine) -> OrderItem:
        product = uow.products.get(line.product_id)
        if product is None or not product.active:
            raise ValidationError("product_unavailable", "منتج غير متاح")
        if program is Program.WHOLESALE and line.qty < product.wholesale_min_qty:
            raise ValidationError("min_qty", f"أقل كمية لـ {product.name} هي {product.wholesale_min_qty}")
        if product.stock < line.qty:
            raise ValidationError("out_of_stock", f"الكمية المتاحة من {product.name}: {product.stock}")
        product.stock -= line.qty
        return OrderItem(product_id=product.id, name=product.name, unit_price=product.price_for(program), qty=line.qty)

    def for_member(self, member_id: int) -> list[Order]:
        with self._uow() as uow:
            return uow.orders.for_member(member_id)

    def get(self, order_id: int, member_id: int | None = None) -> Order:
        with self._uow() as uow:
            order = uow.orders.get(order_id)
            if order is None or (member_id is not None and order.member_id != member_id):
                raise NotFoundError("الطلب غير موجود")
            return order

    # ------------------------------------------------------------------ dashboard side
    def search(self, program: str | None, status: str | None, query: str | None) -> list[Order]:
        with self._uow() as uow:
            return uow.orders.search(program, status, query)

    def change_status(self, admin_id: int | None, order_id: int, status: str, note: str = "") -> Order:
        """Delivery (when paid) creates pending earnings for the upline; a return inside the window cancels them."""
        try:
            target = OrderStatus(status)
        except ValueError:
            raise ValidationError("bad_transition", "حالة غير صحيحة") from None
        with self._uow() as uow:
            order = uow.orders.get(order_id)
            if order is None:
                raise NotFoundError("الطلب غير موجود")
            current = OrderStatus(order.status)
            ensure_transition(current, target)
            handler = {
                OrderStatus.DELIVERED: self._deliver,
                OrderStatus.RETURNED: self._return,
                OrderStatus.CANCELLED: self._cancel,
            }.get(target)
            if handler:
                handler(uow, order)
            order.status = target
            order.history.append(OrderStatusLog(status=target, admin_id=admin_id, note=note, at=self._clock.now()))
            if admin_id:
                uow.audit.record(
                    admin_id, "order_status", "order", order_id, {"from": current, "to": target, "note": note}
                )
            uow.collect(OrderStatusChanged(order.member_id, order.id, target))
            uow.commit()
            return order

    def mark_paid(self, admin_id: int | None, order_id: int) -> Order:
        """Called by the payment gateway webhook (Paymob) or from the dashboard."""
        with self._uow() as uow:
            order = uow.orders.get(order_id)
            if order is None or order.payment_status != PaymentStatus.UNPAID:
                raise ValidationError("not_unpaid", "الطلب مدفوع بالفعل أو غير موجود")
            order.payment_status = PaymentStatus.PAID
            if admin_id:
                uow.audit.record(admin_id, "order_paid", "order", order_id, {})
            uow.commit()
            return order

    def release_matured(self) -> int:
        """Move earnings whose return window has ended from pending to available. Idempotent."""
        with self._uow() as uow:
            released = uow.earnings.release_matured(self._clock.now())
            uow.commit()
            return released

    # ------------------------------------------------------------------ transition handlers
    def _deliver(self, uow: UnitOfWork, order: Order) -> None:
        if order.payment_method == CASH_ON_DELIVERY:
            order.payment_status = PaymentStatus.PAID  # collected by the courier
        if order.payment_status != PaymentStatus.PAID:
            raise ValidationError("unpaid", "لا يمكن تسليم طلب غير مدفوع")
        now = self._clock.now()
        order.delivered_at = now
        order.release_at = now + timedelta(days=load_settings(uow).return_window_days)
        self._create_earnings(uow, order)

    def _create_earnings(self, uow: UnitOfWork, order: Order) -> None:
        # Commission is on the goods value (subtotal), before discount credit and shipping (plan Q2).
        policy = CommissionPolicy(uow.rates.to_config(order.rate_version))
        for share in policy.split(uow.members.upline_ids(order.member_id), order.subtotal):
            if share.amount <= 0:
                continue
            uow.earnings.add(
                Earning(
                    member_id=share.member_id,
                    order_id=order.id,
                    program=order.program,
                    level=share.level,
                    rate_bp=float(share.rate_bp),
                    amount=share.amount,
                    release_at=order.release_at,
                    created_at=self._clock.now(),
                )
            )
            uow.collect(EarningCreated(share.member_id, Program(order.program), share.amount))

    def _return(self, uow: UnitOfWork, order: Order) -> None:
        now = self._clock.now()
        if order.release_at and order.release_at <= now:
            raise ValidationError("window_closed", "انتهت مدة الإرجاع")
        order.payment_status = PaymentStatus.REFUNDED
        order.closed_at = now
        for earning in uow.earnings.for_order(order.id):
            if earning.status == EarningStatus.PENDING:
                earning.status = EarningStatus.CANCELLED
                uow.collect(EarningCancelled(earning.member_id, earning.amount))
        self._restock(uow, order)

    def _cancel(self, uow: UnitOfWork, order: Order) -> None:
        order.closed_at = self._clock.now()
        self._restock(uow, order)

    @staticmethod
    def _restock(uow: UnitOfWork, order: Order) -> None:
        for item in order.items:
            uow.products.get(item.product_id).stock += item.qty
