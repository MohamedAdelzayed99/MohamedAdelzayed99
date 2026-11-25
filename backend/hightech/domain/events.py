"""Domain events + a tiny synchronous event bus (Observer pattern).

Services publish facts ("an earning was created"); subscribers such as the notifier
react to them. Services therefore never depend on notification details.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from .enums import OrderStatus, Program, WithdrawalStatus


@dataclass(frozen=True)
class DomainEvent:
    pass


@dataclass(frozen=True)
class EarningCreated(DomainEvent):
    member_id: int
    program: Program
    amount: int


@dataclass(frozen=True)
class EarningCancelled(DomainEvent):
    member_id: int
    amount: int


@dataclass(frozen=True)
class OrderStatusChanged(DomainEvent):
    member_id: int
    order_id: int
    status: OrderStatus


@dataclass(frozen=True)
class WithdrawalDecided(DomainEvent):
    member_id: int
    amount: int
    status: WithdrawalStatus
    note: str


E = TypeVar("E", bound=DomainEvent)
Handler = Callable[[DomainEvent], None]


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[type[DomainEvent], list[Handler]] = defaultdict(list)

    def subscribe(self, event_type: type[E], handler: Callable[[E], None]) -> None:
        self._handlers[event_type].append(handler)  # type: ignore[arg-type]

    def publish(self, event: DomainEvent) -> None:
        for handler in self._handlers[type(event)]:
            handler(event)
