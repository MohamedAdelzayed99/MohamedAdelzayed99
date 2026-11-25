from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from hightech.domain.commission import DEFAULT_RATES, RateConfig
from hightech.domain.enums import Program
from hightech.domain.errors import ValidationError
from hightech.infrastructure.unit_of_work import UnitOfWork, UnitOfWorkFactory

# Defaults for the plan's open questions (section 10). All editable from the dashboard.
DEFAULT_SETTINGS: dict[str, str] = {
    "return_window_days": "14",  # Q9
    "min_withdrawal": "10000",  # Q4: 100 EGP in piastres
    "withdrawal_methods": json.dumps(["vodafone_cash", "instapay", "bank_transfer"]),  # Q4
    "wholesale_cash_out": "false",  # Q3: wholesale discount is credit on future invoices only
    "wholesale_requires_approval": "true",  # Q8
    "network_names_depth": "1",  # Q10: names for level 1, counts for deeper levels
    "retail_shipping_fee": "5000",  # Q12: 50 EGP
    "wholesale_shipping_fee": "0",
    "payment_methods_retail": json.dumps(["cod"]),  # Q13
    "payment_methods_wholesale": json.dumps(["cod"]),
    "default_sponsor_retail": "",  # Q5: member id for sign-ups without a link ("" = top-level)
    "default_sponsor_wholesale": "",
}


@dataclass(frozen=True)
class AppSettings:
    """Typed, read-only view over the settings table."""

    raw: dict[str, str]

    def _get(self, key: str) -> str:
        return self.raw.get(key, DEFAULT_SETTINGS[key])

    def int(self, key: str) -> int:
        return int(self._get(key) or 0)

    def bool(self, key: str) -> bool:
        return self._get(key) == "true"

    def list(self, key: str) -> list[str]:
        return json.loads(self._get(key) or "[]")

    @property
    def return_window_days(self) -> int:
        return self.int("return_window_days")

    @property
    def min_withdrawal(self) -> int:
        return self.int("min_withdrawal")

    @property
    def withdrawal_methods(self) -> list[str]:
        return self.list("withdrawal_methods")

    @property
    def wholesale_cash_out(self) -> bool:
        return self.bool("wholesale_cash_out")

    @property
    def wholesale_requires_approval(self) -> bool:
        return self.bool("wholesale_requires_approval")

    @property
    def network_names_depth(self) -> int:
        return self.int("network_names_depth")

    def shipping_fee(self, program: Program) -> int:
        return self.int(f"{program}_shipping_fee")

    def payment_methods(self, program: Program) -> list[str]:
        return self.list(f"payment_methods_{program}")

    def default_sponsor(self, program: Program) -> int | None:
        value = self._get(f"default_sponsor_{program}")
        return int(value) if value else None

    def can_cash_out(self, program: Program) -> bool:
        return program is Program.RETAIL or self.wholesale_cash_out


def load_settings(uow: UnitOfWork) -> AppSettings:
    return AppSettings(uow.settings.all())


class SettingsService:
    def __init__(self, uow_factory: UnitOfWorkFactory):
        self._uow = uow_factory

    def ensure_defaults(self) -> None:
        """Idempotent bootstrap: default settings and the initial rate version per program."""
        with self._uow() as uow:
            uow.settings.put_missing(DEFAULT_SETTINGS)
            for program, rates in DEFAULT_RATES.items():
                if uow.rates.current(program) is None:
                    uow.rates.add_version(program, rates, admin_id=None)
            uow.commit()

    def current(self) -> AppSettings:
        with self._uow() as uow:
            return load_settings(uow)

    def all(self) -> dict[str, str]:
        with self._uow() as uow:
            return uow.settings.all()

    def update(self, admin_id: int, patch: dict) -> dict[str, str]:
        with self._uow() as uow:
            for key, value in patch.items():
                if key not in DEFAULT_SETTINGS:
                    raise ValidationError("unknown_setting", f"إعداد غير معروف: {key}")
                uow.settings.put(key, value if isinstance(value, str) else json.dumps(value))
            uow.audit.record(admin_id, "update_settings", "settings", None, patch)
            uow.commit()
            return uow.settings.all()


class RatesService:
    def __init__(self, uow_factory: UnitOfWorkFactory):
        self._uow = uow_factory

    def overview(self) -> dict:
        with self._uow() as uow:
            return {
                "retail": uow.rates.current(Program.RETAIL),
                "wholesale": uow.rates.current(Program.WHOLESALE),
                "history": uow.rates.history(),
            }

    def change(self, admin_id: int, program: Program, rates: RateConfig) -> dict:
        """New rates apply to orders placed from now on; existing orders keep their version."""
        with self._uow() as uow:
            uow.rates.add_version(program, rates, admin_id)
            uow.audit.record(admin_id, "set_rates", "rates", None, {"program": program, **asdict(rates)})
            uow.commit()
        return self.overview()
