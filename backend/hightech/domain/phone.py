import re

from .errors import ValidationError

_EGYPT_MOBILE = re.compile(r"^01[0125]\d{8}$")


def normalize_phone(raw: object) -> str:
    """Normalise an Egyptian mobile number to +201XXXXXXXXX."""
    digits = re.sub(r"\D", "", str(raw or ""))
    for prefix in ("0020", "20"):
        if digits.startswith(prefix) and len(digits) > 11:
            digits = digits[len(prefix) :]
            break
    if not digits.startswith("0"):
        digits = "0" + digits
    if not _EGYPT_MOBILE.match(digits):
        raise ValidationError("invalid_phone", "رقم الموبايل غير صحيح")
    return "+2" + digits


def mask_phone(phone: str) -> str:
    return f"{phone[:5]}*****{phone[-3:]}"
