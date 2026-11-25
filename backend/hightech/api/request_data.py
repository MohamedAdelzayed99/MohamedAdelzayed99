"""Small, explicit request parsing. Raises ValidationError with the field name on bad input."""

from __future__ import annotations

from typing import Any

from flask import request

from hightech.domain.errors import ValidationError


def _invalid(field: str) -> ValidationError:
    return ValidationError(f"invalid_{field}", f"قيمة غير صحيحة: {field}")


class Body:
    def __init__(self, data: Any):
        if not isinstance(data, dict):
            raise ValidationError("bad_json", "طلب غير صحيح")
        self._data = data

    @classmethod
    def from_request(cls) -> Body:
        if not request.data:
            return cls({})
        data = request.get_json(silent=True)
        if data is None:
            raise ValidationError("bad_json", "طلب غير صحيح")
        return cls(data)

    def raw(self, field: str, default: Any = None) -> Any:
        return self._data.get(field, default)

    def has(self, field: str) -> bool:
        return field in self._data

    def str(self, field: str, max_len: int = 500, optional: bool = False) -> str:
        value = self._data.get(field)
        if value in (None, "") and optional:
            return ""
        if not isinstance(value, str) or not value.strip() or len(value) > max_len:
            raise _invalid(field)
        return value.strip()

    def int(self, field: str, minimum: int = 0, default: int | None = None, optional: bool = False) -> int | None:
        value = self._data.get(field, default)
        if value in (None, "") and optional:
            return None
        return to_int(value, field, minimum)

    def bool(self, field: str) -> bool:
        return bool(self._data.get(field))

    def list(self, field: str) -> list:
        value = self._data.get(field)
        if not isinstance(value, list):
            raise _invalid(field)
        return value

    def as_dict(self) -> dict:
        return dict(self._data)


def to_int(value: Any, field: str, minimum: int = 0) -> int:
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        value = int(value)
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise _invalid(field)
    return value


def query(name: str) -> str | None:
    value = request.args.get(name, "").strip()
    return value or None
