"""End-to-end scenarios through the HTTP API (fresh in-memory database per test)."""

from hightech.domain.money import egp


def test_plan_example_chain_earns_after_return_window(api, product):
    khaled = api.signup("retail", "م. خالد")
    a1 = api.signup("retail", "أ1", khaled.code)
    b11 = api.signup("retail", "1.1", a1.code)
    b21 = api.signup("retail", "2.1", b11.code)
    b31 = api.signup("retail", "3.1", b21.code)
    buyer = api.signup("retail", "4.1", b31.code)

    order = api.order(buyer, product["id"])
    assert order["subtotal"] == egp(1000)
    assert api.wallet(b31)["pending"] == 0, "nothing is earned before delivery"

    api.deliver(order["id"])
    assert api.wallet(b31)["pending"] == egp(100)
    for member in (b21, b11, a1, khaled):
        assert api.wallet(member)["pending"] == egp(50)
    assert api.wallet(buyer)["pending"] == 0, "the buyer earns nothing from their own purchase"
    assert api.wallet(b31)["available"] == 0

    notes = api.ok("GET", "/api/retail/notifications", token=khaled.token)
    assert any("50 ج" in n["body"] for n in notes)

    api.pass_return_window()
    assert api.wallet(b31)["available"] == egp(100)
    khaled_wallet = api.wallet(khaled)
    assert (khaled_wallet["available"], khaled_wallet["pending"]) == (egp(50), 0)

    network = api.ok("GET", "/api/retail/network", token=khaled.token)
    assert network["totalMembers"] == 5
    assert network["levels"][0]["members"][0]["name"] == "أ1"
    assert "members" not in network["levels"][1], "deeper levels show counts only"
    assert network["levels"][4]["earnedAvailable"] == egp(50)


def test_return_inside_window_cancels_commission_and_is_refused_after(api, product):
    parent = api.signup("retail", "parent")
    child = api.signup("retail", "child", parent.code)
    first = api.order(child, product["id"], qty=2)
    api.deliver(first["id"])
    assert api.wallet(parent)["pending"] == egp(600)

    api.admin("POST", f"/api/admin/orders/{first['id']}/status", {"status": "returned"})
    wallet = api.wallet(parent)
    assert (wallet["pending"], wallet["available"]) == (0, 0)

    second = api.order(child, product["id"])
    api.deliver(second["id"])
    api.clock.advance(days=20)
    status, body = api.admin_call("POST", f"/api/admin/orders/{second['id']}/status", {"status": "returned"})
    assert (status, body["error"]) == (400, "window_closed")


def test_cancelled_orders_never_pay_commission(api, product):
    parent = api.signup("retail", "parent")
    child = api.signup("retail", "child", parent.code)
    order = api.order(child, product["id"])
    api.admin("POST", f"/api/admin/orders/{order['id']}/status", {"status": "cancelled"})
    api.pass_return_window(30)
    wallet = api.wallet(parent)
    assert wallet["pending"] + wallet["available"] == 0


def test_stock_is_reserved_and_restored(api, product):
    buyer = api.signup("retail", "buyer")
    order = api.order(buyer, product["id"], qty=10)
    assert _stock(api, product["id"]) == 990
    api.admin("POST", f"/api/admin/orders/{order['id']}/status", {"status": "cancelled"})
    assert _stock(api, product["id"]) == 1000
    status, body = api.call(
        "POST",
        "/api/retail/orders",
        {"items": [{"productId": product["id"], "qty": 5000}], "address": "x"},
        buyer.token,
    )
    assert (status, body["error"]) == (400, "out_of_stock")


def _stock(api, product_id):
    return next(p for p in api.admin("GET", "/api/admin/products") if p["id"] == product_id)["stock"]


def test_withdrawal_rules(api, product):
    parent = api.signup("retail", "parent")
    child = api.signup("retail", "child", parent.code)
    api.deliver(api.order(child, product["id"])["id"])

    def withdraw(amount):
        return api.call(
            "POST",
            "/api/retail/wallet/withdrawals",
            {"amount": amount, "method": "vodafone_cash", "account": "01000000000"},
            parent.token,
        )

    assert withdraw(egp(200))[0] == 400, "pending money cannot be withdrawn"
    api.pass_return_window()
    assert withdraw(egp(50))[1]["error"] == "below_min"
    assert withdraw(egp(301))[1]["error"] == "insufficient"
    status, first = withdraw(egp(200))
    assert status == 200
    assert withdraw(egp(100))[1]["error"] == "pending_exists"
    assert api.wallet(parent)["available"] == egp(100)

    api.admin("POST", f"/api/admin/withdrawals/{first['id']}", {"status": "rejected", "note": "wrong number"})
    assert api.wallet(parent)["available"] == egp(300), "a rejection returns the money"
    second = withdraw(egp(300))[1]
    api.admin("POST", f"/api/admin/withdrawals/{second['id']}", {"status": "approved"})
    api.admin("POST", f"/api/admin/withdrawals/{second['id']}", {"status": "paid"})
    assert api.wallet(parent)["available"] == 0
    assert api.admin_call("POST", f"/api/admin/withdrawals/{second['id']}", {"status": "rejected"})[0] == 400


def test_wholesale_flow(api, product):
    top = api.signup("wholesale", "Milano")
    mid = api.signup("wholesale", "Tayeb", top.code)
    shop = api.signup("wholesale", "Mina", mid.code)

    status, _ = api.call(
        "POST", "/api/wholesale/orders", {"items": [{"productId": product["id"], "qty": 5}], "address": "x"}, shop.token
    )
    assert status == 403, "shops must be approved before ordering"
    for member in (top, mid, shop):
        api.admin("POST", f"/api/admin/members/{member.id}/status", {"status": "active"})

    status, body = api.call(
        "POST", "/api/wholesale/orders", {"items": [{"productId": product["id"], "qty": 2}], "address": "x"}, shop.token
    )
    assert body["error"] == "min_qty"

    bulk = api.admin(
        "POST",
        "/api/admin/products",
        {"name": "Bulk", "retailPrice": egp(12000), "wholesalePrice": egp(2000), "wholesaleMinQty": 5, "stock": 100},
    )
    invoice = api.order(shop, bulk["id"], qty=5, program="wholesale")
    assert invoice["subtotal"] == egp(10000)
    api.deliver(invoice["id"])
    api.pass_return_window()

    # Two shops above the buyer: direct 4% = 400, the one above 1% = 100.
    mid_wallet = api.wallet(mid, "wholesale")
    assert mid_wallet["available"] == egp(400)
    assert mid_wallet["canWithdraw"] is False
    assert api.wallet(top, "wholesale")["available"] == egp(100)
    status, _ = api.call(
        "POST",
        "/api/wholesale/wallet/withdrawals",
        {"amount": egp(400), "method": "instapay", "account": "x"},
        mid.token,
    )
    assert status == 403

    next_invoice = api.order(mid, product["id"], qty=5, program="wholesale", useDiscount=True)
    assert (next_invoice["subtotal"], next_invoice["discountUsed"], next_invoice["total"]) == (
        egp(4000),
        egp(400),
        egp(3600),
    )
    assert api.wallet(mid, "wholesale")["available"] == 0
    api.admin("POST", f"/api/admin/orders/{next_invoice['id']}/status", {"status": "cancelled"})
    assert api.wallet(mid, "wholesale")["available"] == egp(400), "cancelling gives the discount back"


def test_programs_are_separate(api, product):
    retail_products = api.ok("GET", "/api/retail/products")
    assert retail_products[0]["price"] == egp(1000)
    assert str(egp(800)) not in str(retail_products), "the wholesale price never reaches the retail app"
    assert api.ok("GET", "/api/wholesale/products")[0]["price"] == egp(800)

    retail = api.signup("retail", "R")
    code = api.ok("POST", "/api/wholesale/auth/request-otp", {"phone": "01099999999"})["devCode"]
    _status, body = api.call(
        "POST",
        "/api/wholesale/auth/verify",
        {
            "phone": "01099999999",
            "code": code,
            "name": "x",
            "shopName": "x",
            "shopAddress": "x",
            "referralCode": retail.code,
        },
    )
    assert body["error"] == "invalid_referral", "a retail code cannot be used in wholesale"
    assert api.call("GET", "/api/wholesale/wallet", token=retail.token)[0] == 401

    code = api.ok("POST", "/api/wholesale/auth/request-otp", {"phone": retail.phone})["devCode"]
    wholesale = api.ok(
        "POST",
        "/api/wholesale/auth/verify",
        {"phone": retail.phone, "code": code, "name": "x", "shopName": "x", "shopAddress": "x"},
    )
    assert wholesale["member"]["id"] != retail.id, "the same phone can have one account in each app"
    assert api.call("GET", "/api/admin/products")[0] == 401


def test_otp_rules(api):
    assert api.call("POST", "/api/retail/auth/request-otp", {"phone": "12345"})[1]["error"] == "invalid_phone"
    first = api.ok("POST", "/api/retail/auth/request-otp", {"phone": "+20 101 234 5678"})
    assert first["phone"] == "+201012345678"
    assert api.sms.sent[-1][0] == "+201012345678"
    assert api.call("POST", "/api/retail/auth/request-otp", {"phone": "01012345678"})[0] == 429
    wrong = "111111" if first["devCode"] == "000000" else "000000"
    for _ in range(5):
        assert (
            api.call("POST", "/api/retail/auth/verify", {"phone": "01012345678", "code": wrong, "name": "x"})[0] == 400
        )
    _status, body = api.call(
        "POST", "/api/retail/auth/verify", {"phone": "01012345678", "code": first["devCode"], "name": "x"}
    )
    assert body["error"] == "otp_locked"


def test_rate_changes_apply_to_new_orders_only(api, product):
    parent = api.signup("retail", "p")
    child = api.signup("retail", "c", parent.code)
    old = api.order(child, product["id"])
    api.admin("PUT", "/api/admin/rates/retail", {"totalBp": 2000, "stepBp": 500, "floorBp": 1000})
    new = api.order(child, product["id"])
    api.deliver(old["id"])
    api.deliver(new["id"])
    assert api.wallet(parent)["pending"] == egp(300) + egp(200)
    _status, body = api.admin_call("PUT", "/api/admin/rates/retail", {"totalBp": 100, "stepBp": 1, "floorBp": 500})
    assert body["error"] == "invalid_rates"


def test_admin_moves_member_with_audit_and_sees_account(api):
    a = api.signup("retail", "a")
    b = api.signup("retail", "b", a.code)
    c = api.signup("retail", "c")
    assert (
        api.admin_call("POST", f"/api/admin/members/{a.id}/move", {"parentId": b.id, "reason": "x"})[1]["error"]
        == "cycle"
    )
    detail = api.admin("POST", f"/api/admin/members/{b.id}/move", {"parentId": c.id, "reason": "requested by customer"})
    assert detail["upline"][0]["id"] == c.id
    assert any(
        log["action"] == "move_member" and log["entity_id"] == b.id for log in api.admin("GET", "/api/admin/audit")
    )
    assert api.admin("GET", f"/api/admin/members?query={b.phone}")[0]["id"] == b.id
    report = api.admin("GET", "/api/admin/reports")
    assert isinstance(report["topNetworks"], list)


def test_suspended_member_is_logged_out(api):
    member = api.signup("retail", "m")
    api.admin("POST", f"/api/admin/members/{member.id}/status", {"status": "suspended"})
    assert api.call("GET", "/api/retail/me", token=member.token)[0] == 401


def test_share_link_landing_page(api):
    member = api.signup("retail", "Khaled")
    response = api.client.get(f"/r/{member.code.lower()}")
    assert response.status_code == 200
    assert "Khaled" in response.get_data(as_text=True)
    assert member.code in response.get_data(as_text=True)


def test_errors_are_json(api):
    assert api.call("GET", "/api/nope/products")[0] == 404
    response = api.client.post("/api/retail/auth/request-otp", data="{bad", content_type="application/json")
    assert response.status_code == 400 and response.get_json()["error"] == "bad_json"
