"""Endpoints used by the two mobile apps: /api/retail/... and /api/wholesale/..."""

from flask import Blueprint, abort, g, jsonify

from hightech.domain.enums import Program
from hightech.services.auth_service import SignupData
from hightech.services.order_service import CartLine, Checkout

from . import presenters as present
from .auth import bearer_token, member_required
from .context import services
from .request_data import Body, query, to_int

bp = Blueprint("member_api", __name__, url_prefix="/api/<program>")


@bp.url_value_preprocessor
def _bind_program(_endpoint, values):
    try:
        g.program = Program(values.pop("program"))
    except ValueError:
        abort(404)


def _public_url() -> str:
    return services().config.public_url


# ---------------------------------------------------------------- sign-in
@bp.post("/auth/request-otp")
def request_otp():
    result = services().member_auth.request_otp(g.program, Body.from_request().raw("phone"))
    body = {"phone": result.phone, "isNewUser": result.is_new_user}
    if result.dev_code:
        body["devCode"] = result.dev_code
    return jsonify(body)


@bp.post("/auth/verify")
def verify_otp():
    body = Body.from_request()
    data = SignupData(
        phone=body.raw("phone"),
        code=str(body.raw("code", "")),
        name=body.raw("name"),
        referral_code=body.raw("referralCode"),
        shop_name=body.raw("shopName"),
        shop_address=body.raw("shopAddress"),
        commercial_reg=body.raw("commercialReg"),
    )
    result = services().member_auth.verify(g.program, data)
    return jsonify(token=result.token, isNew=result.is_new, member=present.member(result.member, _public_url()))


@bp.post("/auth/logout")
@member_required
def logout():
    services().member_auth.logout(bearer_token())
    return jsonify(ok=True)


@bp.get("/referral/<code>")
def referrer(code: str):
    return jsonify(name=services().network.referrer_name(g.program, code))


# ---------------------------------------------------------------- catalogue (public)
@bp.get("/categories")
def categories():
    return jsonify([present.category(c) for c in services().catalog.categories()])


@bp.get("/products")
def products():
    category_id = query("categoryId")
    items = services().catalog.active_products(to_int(category_id, "categoryId") if category_id else None, query("q"))
    return jsonify([present.product_for(p, g.program) for p in items])


@bp.get("/products/<int:product_id>")
def product(product_id: int):
    return jsonify(present.product_for(services().catalog.active_product(product_id), g.program))


@bp.get("/config")
def app_config():
    settings = services().settings.current()
    return jsonify(
        shippingFee=settings.shipping_fee(g.program),
        paymentMethods=settings.payment_methods(g.program),
        returnWindowDays=settings.return_window_days,
    )


# ---------------------------------------------------------------- account
@bp.get("/me")
@member_required
def me():
    return jsonify(present.member(g.member, _public_url()))


@bp.patch("/me")
@member_required
def update_me():
    body = Body.from_request()
    updated = services().network.update_profile(
        g.member.id,
        name=body.raw("name") if body.has("name") else None,
        push_token=str(body.raw("pushToken")) if body.raw("pushToken") else None,
        clear_push=body.has("pushToken") and not body.raw("pushToken"),
    )
    return jsonify(present.member(updated, _public_url()))


# ---------------------------------------------------------------- orders
@bp.get("/orders")
@member_required
def my_orders():
    return jsonify([present.order(o) for o in services().orders.for_member(g.member.id)])


@bp.post("/orders")
@member_required
def place_order():
    body = Body.from_request()
    lines = [
        CartLine(
            to_int(item.get("productId") if isinstance(item, dict) else None, "productId", 1),
            to_int(item.get("qty") if isinstance(item, dict) else None, "qty", 1),
        )
        for item in body.list("items")
    ]
    checkout = Checkout(
        lines=lines,
        address=body.str("address", 300),
        governorate=body.str("governorate", 50, optional=True),
        contact_phone=str(body.raw("contactPhone"))[:20] if body.raw("contactPhone") else None,
        notes=body.str("notes", 500, optional=True),
        payment_method=str(body.raw("paymentMethod") or "cod"),
        use_discount=body.bool("useDiscount"),
    )
    return jsonify(present.order(services().orders.place(g.member, checkout)))


@bp.get("/orders/<int:order_id>")
@member_required
def my_order(order_id: int):
    return jsonify(present.order(services().orders.get(order_id, member_id=g.member.id)))


# ---------------------------------------------------------------- wallet & network
@bp.get("/wallet")
@member_required
def wallet():
    return jsonify(present.wallet(services().wallet.view(g.member)))


@bp.post("/wallet/withdrawals")
@member_required
def request_withdrawal():
    body = Body.from_request()
    withdrawal = services().wallet.request_withdrawal(
        g.member, body.int("amount", 1), body.str("method", 30), body.str("account", 100)
    )
    return jsonify(present.withdrawal(withdrawal))


@bp.get("/network")
@member_required
def network():
    return jsonify(present.network(services().network.for_member(g.member.id)))


@bp.get("/notifications")
@member_required
def notifications():
    return jsonify([present.notification(n) for n in services().notifications.for_member(g.member.id)])


@bp.post("/notifications/read")
@member_required
def read_notifications():
    services().notifications.mark_all_read(g.member.id)
    return jsonify(ok=True)
