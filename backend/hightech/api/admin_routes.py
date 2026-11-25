"""Dashboard endpoints: /api/admin/..."""

from flask import Blueprint, g, jsonify

from hightech.domain.commission import RateConfig
from hightech.domain.enums import Program
from hightech.domain.errors import NotFoundError
from hightech.domain.phone import normalize_phone
from hightech.services.catalog_service import ProductData

from . import presenters as present
from .auth import admin_required
from .context import services
from .request_data import Body, query, to_int

bp = Blueprint("admin_api", __name__, url_prefix="/api/admin")


def _public_url() -> str:
    return services().config.public_url


@bp.post("/login")
def login():
    body = Body.from_request()
    token, admin = services().admin_auth.login(body.raw("username"), body.raw("password"))
    return jsonify(token=token, admin={"id": admin.id, "username": admin.username, "name": admin.name})


@bp.get("/me")
@admin_required
def me():
    return jsonify(id=g.admin.id, username=g.admin.username, name=g.admin.name)


# ---------------------------------------------------------------- catalogue
@bp.get("/categories")
@admin_required
def categories():
    return jsonify([present.category(c) for c in services().catalog.categories()])


@bp.post("/categories")
@bp.put("/categories/<int:category_id>")
@admin_required
def save_category(category_id: int | None = None):
    body = Body.from_request()
    category = services().catalog.save_category(category_id, body.str("name", 60), body.int("sort", 0, default=0))
    return jsonify(present.category(category))


@bp.get("/products")
@admin_required
def products():
    return jsonify([present.product_admin(p) for p in services().catalog.all_products()])


@bp.post("/products")
@bp.put("/products/<int:product_id>")
@admin_required
def save_product(product_id: int | None = None):
    body = Body.from_request()
    data = ProductData(
        name=body.str("name", 150),
        retail_price=body.int("retailPrice"),
        wholesale_price=body.int("wholesalePrice"),
        category_id=body.int("categoryId", 1, optional=True),
        description=body.str("description", 3000, optional=True),
        image_url=body.str("imageUrl", 500, optional=True) or None,
        retail_offer_price=body.int("retailOfferPrice", optional=True),
        wholesale_min_qty=body.int("wholesaleMinQty", 1, default=1),
        stock=body.int("stock", 0, default=0),
        active=body.raw("active") is not False,
    )
    return jsonify(present.product_admin(services().catalog.save_product(g.admin.id, product_id, data)))


# ---------------------------------------------------------------- orders
@bp.get("/orders")
@admin_required
def orders():
    found = services().orders.search(query("program"), query("status"), query("query"))
    return jsonify([present.order_admin(o) for o in found])


@bp.get("/orders/<int:order_id>")
@admin_required
def order(order_id: int):
    return jsonify(present.order(services().orders.get(order_id)))


@bp.post("/orders/<int:order_id>/status")
@admin_required
def order_status(order_id: int):
    body = Body.from_request()
    updated = services().orders.change_status(
        g.admin.id, order_id, str(body.raw("status", "")), str(body.raw("note", ""))[:300]
    )
    return jsonify(present.order(updated))


@bp.post("/orders/<int:order_id>/paid")
@admin_required
def order_paid(order_id: int):
    return jsonify(present.order(services().orders.mark_paid(g.admin.id, order_id)))


# ---------------------------------------------------------------- members
@bp.get("/members")
@admin_required
def members():
    s = services()
    result = []
    for m, direct_count in s.member_admin.search(query("program"), query("status"), query("query")):
        result.append(
            {
                **present.member(m, _public_url()),
                "directCount": direct_count,
                "parentId": m.parent_id,
                **present.balances(s.wallet.balances(m.id)),
            }
        )
    return jsonify(result)


@bp.post("/members")
@admin_required
def create_member():
    body = Body.from_request()
    created = services().member_admin.create(
        g.admin.id,
        Program.WHOLESALE if body.raw("program") == "wholesale" else Program.RETAIL,
        normalize_phone(body.raw("phone")),
        body.str("name", 80),
        body.int("parentId", 1, optional=True),
        body.str("shopName", 120, optional=True),
        body.str("shopAddress", 300, optional=True),
    )
    return jsonify(present.member(created, _public_url()))


def _member_detail(member_id: int) -> dict:
    """Everything about one account, exactly as the member sees it in the app, plus the upline."""
    s = services()
    m = s.member_admin.get(member_id)
    return {
        "member": present.member_admin(m, _public_url()),
        "upline": [
            {"id": u.id, "name": u.display_name, "phone": u.phone, "referralCode": u.referral_code}
            for u in s.member_admin.upline(member_id)
        ],
        "network": present.network(s.member_admin.full_network(member_id), include_all=True),
        "wallet": present.wallet(s.wallet.view(m)),
        "orders": [present.order(o) for o in s.orders.for_member(member_id)],
    }


@bp.get("/members/<int:member_id>")
@admin_required
def member(member_id: int):
    return jsonify(_member_detail(member_id))


@bp.post("/members/<int:member_id>/status")
@admin_required
def member_status(member_id: int):
    services().member_admin.set_status(g.admin.id, member_id, str(Body.from_request().raw("status")))
    return jsonify(_member_detail(member_id))


@bp.post("/members/<int:member_id>/move")
@admin_required
def move_member(member_id: int):
    body = Body.from_request()
    parent = body.raw("parentId")
    new_parent = None if parent in (None, "") else to_int(parent, "parentId", 1)
    services().member_admin.move(g.admin.id, member_id, new_parent, body.str("reason", 300))
    return jsonify(_member_detail(member_id))


# ---------------------------------------------------------------- rates & settings
@bp.get("/rates")
@admin_required
def rates():
    return jsonify(_rates(services().rates.overview()))


@bp.put("/rates/<program>")
@admin_required
def set_rates(program: str):
    try:
        prog = Program(program)
    except ValueError:
        raise NotFoundError() from None
    body = Body.from_request()
    config = RateConfig(body.int("totalBp"), body.int("stepBp"), body.int("floorBp"))
    return jsonify(_rates(services().rates.change(g.admin.id, prog, config)))


def _rates(overview: dict) -> dict:
    return {
        "retail": present.rate_version(overview["retail"]),
        "wholesale": present.rate_version(overview["wholesale"]),
        "history": [present.rate_version(r) for r in overview["history"]],
    }


@bp.get("/settings")
@admin_required
def settings():
    return jsonify(services().settings.all())


@bp.patch("/settings")
@admin_required
def update_settings():
    return jsonify(services().settings.update(g.admin.id, Body.from_request().as_dict()))


# ---------------------------------------------------------------- withdrawals, reports, jobs
@bp.get("/withdrawals")
@admin_required
def withdrawals():
    return jsonify([present.withdrawal_admin(w) for w in services().wallet.list(query("status"))])


@bp.post("/withdrawals/<int:withdrawal_id>")
@admin_required
def decide_withdrawal(withdrawal_id: int):
    body = Body.from_request()
    decided = services().wallet.decide(
        g.admin.id, withdrawal_id, str(body.raw("status", "")), str(body.raw("note", ""))[:300]
    )
    return jsonify(present.withdrawal(decided))


@bp.get("/reports")
@admin_required
def reports():
    return jsonify(services().reports.dashboard(query("from"), query("to")))


@bp.post("/jobs/release")
@admin_required
def release_job():
    return jsonify(released=services().orders.release_matured())


@bp.get("/audit")
@admin_required
def audit_log():
    return jsonify([present.audit(a) for a in services().reports.audit_log()])
