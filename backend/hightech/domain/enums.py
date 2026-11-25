from enum import StrEnum


class Program(StrEnum):
    """The two separate apps. Each has its own tree, login, prices and rates."""

    RETAIL = "retail"
    WHOLESALE = "wholesale"

    @property
    def code_prefix(self) -> str:
        return "R" if self is Program.RETAIL else "W"

    @property
    def link_path(self) -> str:
        return "r" if self is Program.RETAIL else "w"


class MemberStatus(StrEnum):
    ACTIVE = "active"
    PENDING_APPROVAL = "pending_approval"
    SUSPENDED = "suspended"


class OrderStatus(StrEnum):
    PLACED = "placed"
    CONFIRMED = "confirmed"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    RETURNED = "returned"
    CANCELLED = "cancelled"

    @property
    def label_ar(self) -> str:
        return _ORDER_STATUS_AR[self]


_ORDER_STATUS_AR = {
    OrderStatus.PLACED: "تم الطلب",
    OrderStatus.CONFIRMED: "تم التأكيد",
    OrderStatus.SHIPPED: "في الطريق",
    OrderStatus.DELIVERED: "تم التسليم",
    OrderStatus.RETURNED: "مرتجع",
    OrderStatus.CANCELLED: "ملغي",
}


class PaymentStatus(StrEnum):
    UNPAID = "unpaid"
    PAID = "paid"
    REFUNDED = "refunded"


class EarningStatus(StrEnum):
    PENDING = "pending"
    AVAILABLE = "available"
    CANCELLED = "cancelled"


class WithdrawalStatus(StrEnum):
    REQUESTED = "requested"
    APPROVED = "approved"
    PAID = "paid"
    REJECTED = "rejected"
