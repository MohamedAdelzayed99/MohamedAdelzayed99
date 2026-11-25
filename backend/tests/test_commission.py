"""Every example from the High Tech plan document (sections 2 and 3)."""

from fractions import Fraction

import pytest

from hightech.domain.commission import DEFAULT_RATES, CommissionPolicy, RateConfig
from hightech.domain.enums import Program
from hightech.domain.errors import ValidationError
from hightech.domain.money import egp

RETAIL = CommissionPolicy(DEFAULT_RATES[Program.RETAIL])
WHOLESALE = CommissionPolicy(DEFAULT_RATES[Program.WHOLESALE])


def amounts(policy, upline, total):
    return [s.amount for s in policy.split(upline, total)]


@pytest.mark.parametrize("above, direct_pct", [(1, 30), (2, 25), (3, 20), (4, 15), (5, 10), (6, 10), (50, 10)])
def test_retail_direct_share_table(above, direct_pct):
    assert RETAIL.direct_rate_bp(above) == direct_pct * 100


@pytest.mark.parametrize("n", range(1, 31))
def test_retail_total_is_always_30_percent_and_5_percent_above_until_floor(n):
    shares = RETAIL.split(list(range(n)), egp(1000))
    assert sum(s.rate_bp for s in shares) == 3000
    if 2 <= n <= 5:
        assert all(s.rate_bp == 500 for s in shares[1:])


def test_retail_example_4_1_buys_for_1000():
    upline = ["3.1", "2.1", "1.1", "أ1", "م. خالد"]  # direct link owner first
    shares = RETAIL.split(upline, egp(1000))
    assert [(s.member_id, s.amount) for s in shares] == [
        ("3.1", egp(100)),
        ("2.1", egp(50)),
        ("1.1", egp(50)),
        ("أ1", egp(50)),
        ("م. خالد", egp(50)),
    ]
    assert sum(s.amount for s in shares) == egp(300)
    assert [s.level for s in shares] == [1, 2, 3, 4, 5]


def test_retail_eleven_above_direct_100_each_other_20():
    assert amounts(RETAIL, list(range(11)), egp(1000)) == [egp(100)] + [egp(20)] * 10


def test_buyer_with_nobody_above_pays_nobody():
    assert RETAIL.split([], egp(1000)) == []


@pytest.mark.parametrize("above, direct_pct", [(1, 5), (2, 4), (3, 3), (4, 3), (20, 3)])
def test_wholesale_direct_share_table(above, direct_pct):
    assert WHOLESALE.direct_rate_bp(above) == direct_pct * 100


def test_wholesale_invoice_10000_examples():
    assert amounts(WHOLESALE, ["A"], egp(10000)) == [egp(500)]
    assert amounts(WHOLESALE, ["A", "B"], egp(10000)) == [egp(400), egp(100)]
    assert amounts(WHOLESALE, ["A", "B", "C"], egp(10000)) == [egp(300), egp(100), egp(100)]
    assert amounts(WHOLESALE, list("ABCDEF"), egp(10000)) == [egp(300)] + [egp(40)] * 5


def test_uneven_split_is_exact_as_a_fraction():
    shares = WHOLESALE.split(list("ABCD"), egp(10000))
    assert shares[1].rate_bp == Fraction(200, 3)


@pytest.mark.parametrize("amount", [1, 7, 99, 12345, 999999])
def test_never_distributes_more_than_the_total(amount):
    for n in range(1, 16):
        for policy in (RETAIL, WHOLESALE):
            total = sum(s.amount for s in policy.split(list(range(n)), amount))
            assert total <= amount * policy.rates.total_bp // 10000


def test_custom_rates_and_validation():
    custom = CommissionPolicy(RateConfig(total_bp=2000, step_bp=400, floor_bp=800))
    assert amounts(custom, list("abcd"), egp(1000)) == [egp(80), egp(40), egp(40), egp(40)]
    with pytest.raises(ValidationError):
        RateConfig(total_bp=100, step_bp=10, floor_bp=200)
    with pytest.raises(ValidationError):
        RETAIL.split(["a"], 1.5)
