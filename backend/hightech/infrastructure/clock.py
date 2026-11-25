"""Replaceable clock (tests fast-forward past the return window)."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return utcnow()


class FixedClock:
    """Test double: time only moves when told to."""

    def __init__(self, start: datetime | None = None):
        self._now = start or utcnow()

    def now(self) -> datetime:
        return self._now

    def advance(self, **delta: float) -> None:
        from datetime import timedelta

        self._now += timedelta(**delta)


ClockFn = Callable[[], datetime]
