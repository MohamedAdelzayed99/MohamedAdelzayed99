"""Presenters: ORM objects → JSON-ready dicts. The response shapes are the API contract used by the apps."""

from __future__ import annotations

from datetime import datetime

from hightech.domain.enums import OrderStatus, Program
from hightech.domain.phone import mask_phone
from hightech.infrastructure.models import (
    AuditLog,
    Category,
    Earning,
    Member,
    Notification,
    Order,
    Product,
    RateVersion,
    Withdrawal,
)
from hightech.services.network_service import NetworkView
from hightech.services.wallet_service import Balances, WalletView


def ts(value: datetime | None) -> str | None:
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else None


def share_link(member: Member, public_url: str) -> str:
    return f"{public_url}/{Program(member.program).link_path}/{member.referral_code}"


def member(m: Member, public_url: str) -> dict:
    return {
        "id": m.id,
        "program": m.program,
        "phone": m.phone,
        "name": m.name,
        "referralCode": m.referral_code,
        "shareLink": share_link(m, public_url),
        "status": m.status,
        "shopName": m.shop_name,
        "shopAddress": m.shop_address,
        "payoutMethod": m.payout_method,
        "payoutAccount": m.payout_account,
        "createdAt": ts(m.created_at),
    }


def member_admin(m: Member, public_url: str) -> dict:
    return {
        **member(m, public_url),
        "parentId": m.parent_id,
        "commercialReg": m.commercial_reg,
        "lastActiveAt": ts(m.last_active_at),
    }


def balances(b: Balances) -> dict:
    return {
        "available": b.available,
        "pending": b.pending,
        "withdrawn": b.withdrawn,
        "usedOnInvoices": b.used_on_invoices,
        "lifetime": b.lifetime,
    }


def category(c: Category) -> dict:
    return {"id": c.id, "name": c.name, "sort": c.sort}


def product_for(p: Product, program: Program) -> dict:
    """Catalogue view for one app. Never includes the other program's price."""
    view = {
        "id": p.id,
        "categoryId": p.category_id,
        "name": p.name,
        "description": p.description,
        "imageUrl": p.image_url,
        "price": p.price_for(program),
        "inStock": p.stock > 0,
    }
    if program is Program.RETAIL:
        view["originalPrice"] = p.retail_price if p.retail_offer_price is not None else None
    else:
        view["minQty"] = p.wholesale_min_qty
    return view


def product_admin(p: Product) -> dict:
    return {
        "id": p.id,
        "categoryId": p.category_id,
        "name": p.name,
        "description": p.description,
        "imageUrl": p.image_url,
        "retailPrice": p.retail_price,
        "retailOfferPrice": p.retail_offer_price,
        "wholesalePrice": p.wholesale_price,
        "wholesaleMinQty": p.wholesale_min_qty,
        "stock": p.stock,
        "active": p.active,
        "createdAt": ts(p.created_at),
    }


def order(o: Order) -> dict:
    status = OrderStatus(o.status)
    return {
        "id": o.id,
        "program": o.program,
        "memberId": o.member_id,
        "status": status,
        "statusLabel": status.label_ar,
        "paymentMethod": o.payment_method,
        "paymentStatus": o.payment_status,
        "subtotal": o.subtotal,
        "discountUsed": o.discount_used,
        "shippingFee": o.shipping_fee,
        "total": o.total,
        "address": o.address,
        "governorate": o.governorate,
        "contactPhone": o.contact_phone,
        "notes": o.notes,
        "createdAt": ts(o.created_at),
        "deliveredAt": ts(o.delivered_at),
        "releaseAt": ts(o.release_at),
        "items": [
            {"productId": i.product_id, "name": i.name, "unitPrice": i.unit_price, "qty": i.qty} for i in o.items
        ],
        "history": [{"status": h.status, "note": h.note, "at": ts(h.at)} for h in o.history],
    }


def order_admin(o: Order) -> dict:
    return {**order(o), "member": {"id": o.member.id, "name": o.member.display_name, "phone": o.member.phone}}


def earning(e: Earning) -> dict:
    return {
        "id": e.id,
        "order_id": e.order_id,
        "level": e.level,
        "amount": e.amount,
        "status": e.status,
        "release_at": ts(e.release_at),
        "created_at": ts(e.created_at),
    }


def withdrawal(w: Withdrawal) -> dict:
    return {
        "id": w.id,
        "member_id": w.member_id,
        "amount": w.amount,
        "method": w.method,
        "account": w.account,
        "status": w.status,
        "note": w.note,
        "created_at": ts(w.created_at),
        "decided_at": ts(w.decided_at),
        "decided_by": w.decided_by,
    }


def withdrawal_admin(w: Withdrawal) -> dict:
    return {**withdrawal(w), "member_name": w.member.display_name, "member_phone": w.member.phone}


def wallet(v: WalletView) -> dict:
    return {
        **balances(v.balances),
        "minWithdrawal": v.min_withdrawal,
        "canWithdraw": v.can_withdraw,
        "withdrawalMethods": v.withdrawal_methods,
        "earnings": [earning(e) for e in v.earnings],
        "withdrawals": [withdrawal(w) for w in v.withdrawals],
    }


def network(view: NetworkView, include_all: bool = False) -> dict:
    levels = []
    for lvl in view.levels:
        entry = {
            "level": lvl.level,
            "count": lvl.count,
            "earnedAvailable": lvl.earned_available,
            "earnedPending": lvl.earned_pending,
        }
        if lvl.members is not None:
            entry["members"] = [
                {"id": m.id, "name": m.display_name, "phone": mask_phone(m.phone), "joinedAt": ts(m.created_at)}
                for m in lvl.members
            ]
        levels.append(entry)
    result = {"totalMembers": view.total_members, "levels": levels}
    if include_all:
        result["members"] = [
            {"id": m.id, "depth": depth, "name": m.display_name, "phone": m.phone, "parentId": m.parent_id}
            for depth, m in view.all_members
        ]
    return result


def notification(n: Notification) -> dict:
    return {"id": n.id, "title": n.title, "body": n.body, "read": n.read, "created_at": ts(n.created_at)}


def rate_version(r: RateVersion | None) -> dict | None:
    if r is None:
        return None
    return {
        "id": r.id,
        "program": r.program,
        "total_bp": r.total_bp,
        "step_bp": r.step_bp,
        "floor_bp": r.floor_bp,
        "created_by": r.created_by,
        "created_at": ts(r.created_at),
    }


def audit(a: AuditLog) -> dict:
    return {
        "id": a.id,
        "admin_id": a.admin_id,
        "username": a.admin.username if a.admin else None,
        "action": a.action,
        "entity": a.entity,
        "entity_id": a.entity_id,
        "details": a.details,
        "at": ts(a.at),
    }
