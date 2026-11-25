"""Referral commission rules (plan sections 2 and 3).

Let n be the number of people above the buyer (the buyer's upline, parent first).
  * The direct link owner gets   max(total - step * (n - 1), floor)
  * The rest (total - direct) is split equally among the other n - 1 people above.
    While the direct share is above the floor this is exactly `step` each.
  * The buyer earns nothing from their own purchase.

`CommissionPolicy` is a Strategy: each program gets an instance built from its
current `RateConfig`, and orders keep the rate version they were placed with.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from fractions import Fraction
from typing import Generic, TypeVar

from .enums import Program
from .errors import ValidationError
from .money import BP_PER_UNIT

MemberId = TypeVar("MemberId")


@dataclass(frozen=True, slots=True)
class RateConfig:
    total_bp: int
    step_bp: int
    floor_bp: int

    def __post_init__(self) -> None:
        problems = self.problems()
        if problems:
            raise ValidationError("invalid_rates", "; ".join(problems))

    def problems(self) -> list[str]:
        errors = []
        for name in ("total_bp", "step_bp", "floor_bp"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                errors.append(f"{name} must be a non-negative integer")
        if not errors:
            if self.floor_bp > self.total_bp:
                errors.append("floor_bp cannot exceed total_bp")
            if self.total_bp > BP_PER_UNIT:
                errors.append("total_bp cannot exceed 10000 (100%)")
        return errors


DEFAULT_RATES: dict[Program, RateConfig] = {
    Program.RETAIL: RateConfig(total_bp=3000, step_bp=500, floor_bp=1000),  # 30% cash commission
    Program.WHOLESALE: RateConfig(total_bp=500, step_bp=100, floor_bp=300),  # 5% discount credit
}


@dataclass(frozen=True, slots=True)
class Share(Generic[MemberId]):
    member_id: MemberId
    level: int  # 1 = direct link owner, 2 = the person above them, ...
    rate_bp: Fraction
    amount: int  # piastres


class CommissionPolicy:
    def __init__(self, rates: RateConfig):
        self.rates = rates

    def direct_rate_bp(self, people_above: int) -> int:
        if people_above < 1:
            return 0
        r = self.rates
        return max(r.total_bp - r.step_bp * (people_above - 1), r.floor_bp)

    def split(self, upline: Sequence[MemberId], amount: int) -> list[Share[MemberId]]:
        """Split `amount` (piastres) between `upline` (parent first, root last).

        Each share is floored to a whole piastre; sub-piastre remainders stay with the company.
        """
        if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
            raise ValidationError("invalid_amount", "amount must be a non-negative integer (piastres)")
        n = len(upline)
        if n == 0:
            return []
        direct = self.direct_rate_bp(n)
        others_rate = Fraction(self.rates.total_bp - direct, n - 1) if n > 1 else Fraction(0)
        shares = [Share(upline[0], 1, Fraction(direct), amount * direct // BP_PER_UNIT)]
        for index, member_id in enumerate(upline[1:], start=2):
            shares.append(Share(member_id, index, others_rate, int(amount * others_rate // BP_PER_UNIT)))
        return shares
