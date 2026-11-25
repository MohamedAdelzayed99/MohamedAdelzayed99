from __future__ import annotations

from dataclasses import dataclass, field
from itertools import count

import pytest

from hightech import create_app
from hightech.config import test_config
from hightech.container import build_container
from hightech.domain.money import egp
from hightech.infrastructure.clock import FixedClock
from hightech.infrastructure.gateways import RecordingSmsSender

ADMIN_PASSWORD = "password123"


@dataclass
class Signed:
    token: str
    id: int
    code: str
    phone: str


@dataclass
class Api:
    """Test driver for the HTTP API (keeps the tests readable)."""

    client: object
    clock: FixedClock
    sms: RecordingSmsSender
    _admin_token: str | None = None
    _phones: count = field(default_factory=lambda: count(1))

    def call(self, method: str, path: str, body=None, token: str | None = None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        response = self.client.open(path, method=method, json=body, headers=headers)
        return response.status_code, response.get_json()

    def ok(self, method: str, path: str, body=None, token: str | None = None):
        status, data = self.call(method, path, body, token)
        assert status < 300, f"{method} {path} -> {status} {data}"
        return data

    def admin(self, method: str, path: str, body=None):
        # Admin sessions last 7 days; tests move the clock forward, so log in again when needed.
        if self._admin_token is None or self.call("GET", "/api/admin/me", token=self._admin_token)[0] == 401:
            self._admin_token = self.ok("POST", "/api/admin/login", {"username": "admin", "password": ADMIN_PASSWORD})[
                "token"
            ]
        return self.ok(method, path, body, self._admin_token)

    def admin_call(self, method: str, path: str, body=None):
        self.admin("GET", "/api/admin/me")
        return self.call(method, path, body, self._admin_token)

    def signup(self, program: str, name: str, referral_code: str | None = None) -> Signed:
        phone = f"0101{next(self._phones):07d}"
        dev_code = self.ok("POST", f"/api/{program}/auth/request-otp", {"phone": phone})["devCode"]
        extra = {"shopName": name, "shopAddress": "Cairo"} if program == "wholesale" else {}
        result = self.ok(
            "POST",
            f"/api/{program}/auth/verify",
            {"phone": phone, "code": dev_code, "name": name, "referralCode": referral_code, **extra},
        )
        return Signed(result["token"], result["member"]["id"], result["member"]["referralCode"], phone)

    def order(self, member: Signed, product_id: int, qty: int = 1, program: str = "retail", **extra):
        return self.ok(
            "POST",
            f"/api/{program}/orders",
            {"items": [{"productId": product_id, "qty": qty}], "address": "Cairo", **extra},
            member.token,
        )

    def deliver(self, order_id: int):
        for status in ("confirmed", "shipped", "delivered"):
            self.admin("POST", f"/api/admin/orders/{order_id}/status", {"status": status})

    def wallet(self, member: Signed, program: str = "retail"):
        return self.ok("GET", f"/api/{program}/wallet", token=member.token)

    def pass_return_window(self, days: int = 15):
        self.clock.advance(days=days)
        self.admin("POST", "/api/admin/jobs/release")


@pytest.fixture
def api() -> Api:
    clock = FixedClock()
    sms = RecordingSmsSender()
    container = build_container(test_config(), clock=clock, sms=sms)
    container.admin_auth.create_admin("admin", ADMIN_PASSWORD, "Admin")
    app = create_app(container=container)
    return Api(app.test_client(), clock, sms)


@pytest.fixture
def product(api: Api) -> dict:
    return api.admin(
        "POST",
        "/api/admin/products",
        {
            "name": "Power bank",
            "retailPrice": egp(1000),
            "wholesalePrice": egp(800),
            "wholesaleMinQty": 5,
            "stock": 1000,
        },
    )
