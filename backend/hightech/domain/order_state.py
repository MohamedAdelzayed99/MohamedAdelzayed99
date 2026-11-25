"""Order lifecycle as an explicit state machine (State pattern, table driven)."""

from .enums import OrderStatus
from .errors import ValidationError

_TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.PLACED: frozenset({OrderStatus.CONFIRMED, OrderStatus.CANCELLED}),
    OrderStatus.CONFIRMED: frozenset({OrderStatus.SHIPPED, OrderStatus.CANCELLED}),
    OrderStatus.SHIPPED: frozenset({OrderStatus.DELIVERED, OrderStatus.CANCELLED}),
    OrderStatus.DELIVERED: frozenset({OrderStatus.RETURNED}),
    OrderStatus.RETURNED: frozenset(),
    OrderStatus.CANCELLED: frozenset(),
}

# Orders whose goods (and discount credit) count as consumed.
CLOSED_WITHOUT_SALE = frozenset({OrderStatus.CANCELLED, OrderStatus.RETURNED})


def allowed_next(status: OrderStatus) -> frozenset[OrderStatus]:
    return _TRANSITIONS[status]


def ensure_transition(current: OrderStatus, target: OrderStatus) -> None:
    if target not in _TRANSITIONS[current]:
        raise ValidationError("bad_transition", f"لا يمكن التحويل من «{current.label_ar}» إلى «{target.label_ar}»")
