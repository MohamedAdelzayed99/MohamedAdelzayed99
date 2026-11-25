import pytest

from hightech.domain.enums import OrderStatus as S
from hightech.domain.errors import ValidationError
from hightech.domain.order_state import ensure_transition
from hightech.domain.phone import normalize_phone


@pytest.mark.parametrize(
    "current, target",
    [
        (S.PLACED, S.CONFIRMED),
        (S.CONFIRMED, S.SHIPPED),
        (S.SHIPPED, S.DELIVERED),
        (S.DELIVERED, S.RETURNED),
        (S.PLACED, S.CANCELLED),
        (S.SHIPPED, S.CANCELLED),
    ],
)
def test_allowed_transitions(current, target):
    ensure_transition(current, target)


@pytest.mark.parametrize(
    "current, target",
    [
        (S.PLACED, S.DELIVERED),
        (S.DELIVERED, S.CANCELLED),
        (S.CANCELLED, S.PLACED),
        (S.RETURNED, S.DELIVERED),
    ],
)
def test_refused_transitions(current, target):
    with pytest.raises(ValidationError):
        ensure_transition(current, target)


@pytest.mark.parametrize(
    "raw", ["01012345678", "+201012345678", "201012345678", "00201012345678", "+20 101 234 5678", "1012345678"]
)
def test_phone_normalisation(raw):
    assert normalize_phone(raw) == "+201012345678"


@pytest.mark.parametrize("raw", ["12345", "01312345678", "", None, "0101234567"])
def test_invalid_phones(raw):
    with pytest.raises(ValidationError):
        normalize_phone(raw)
