"""SQLAlchemy ORM models (SQLite by default, any SQLAlchemy database in production)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from hightech.domain.enums import (
    EarningStatus,
    MemberStatus,
    OrderStatus,
    PaymentStatus,
    Program,
    WithdrawalStatus,
)

from .clock import utcnow


class Base(DeclarativeBase):
    pass


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (UniqueConstraint("program", "phone"), Index("ix_members_parent", "parent_id"))

    id: Mapped[int] = mapped_column(primary_key=True)
    program: Mapped[Program] = mapped_column(String(10))
    phone: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(80))
    referral_code: Mapped[str] = mapped_column(String(12), unique=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("members.id"))
    status: Mapped[MemberStatus] = mapped_column(String(20), default=MemberStatus.ACTIVE)
    shop_name: Mapped[str | None] = mapped_column(String(120))
    shop_address: Mapped[str | None] = mapped_column(String(300))
    commercial_reg: Mapped[str | None] = mapped_column(String(60))
    push_token: Mapped[str | None] = mapped_column(String(200))
    payout_method: Mapped[str | None] = mapped_column(String(30))
    payout_account: Mapped[str | None] = mapped_column(String(100))
    last_active_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    @property
    def display_name(self) -> str:
        return self.shop_name or self.name


class OtpCode(Base):
    __tablename__ = "otp_codes"

    program: Mapped[str] = mapped_column(String(10), primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime]
    attempts: Mapped[int] = mapped_column(default=0)
    sent_at: Mapped[datetime]


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(80))


class AuthSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10))  # "member" | "admin"
    subject_id: Mapped[int]
    expires_at: Mapped[datetime]


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    sort: Mapped[int] = mapped_column(default=0)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("retail_price >= 0"),
        CheckConstraint("wholesale_price >= 0"),
        CheckConstraint("stock >= 0"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(500))
    retail_price: Mapped[int]
    retail_offer_price: Mapped[int | None]
    wholesale_price: Mapped[int]
    wholesale_min_qty: Mapped[int] = mapped_column(default=1)
    stock: Mapped[int] = mapped_column(default=0)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    def price_for(self, program: Program) -> int:
        """Retail members never see wholesale prices and vice versa."""
        if program is Program.RETAIL:
            return self.retail_offer_price if self.retail_offer_price is not None else self.retail_price
        return self.wholesale_price


class RateVersion(Base):
    """Rates are append-only: an order keeps the version it was placed with."""

    __tablename__ = "rate_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    program: Mapped[Program] = mapped_column(String(10))
    total_bp: Mapped[int]
    step_bp: Mapped[int]
    floor_bp: Mapped[int]
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_member", "member_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    program: Mapped[Program] = mapped_column(String(10))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    status: Mapped[OrderStatus] = mapped_column(String(12), default=OrderStatus.PLACED)
    payment_method: Mapped[str] = mapped_column(String(20), default="cod")
    payment_status: Mapped[PaymentStatus] = mapped_column(String(10), default=PaymentStatus.UNPAID)
    subtotal: Mapped[int]
    discount_used: Mapped[int] = mapped_column(default=0)
    shipping_fee: Mapped[int] = mapped_column(default=0)
    total: Mapped[int]
    address: Mapped[str] = mapped_column(String(300))
    governorate: Mapped[str] = mapped_column(String(50), default="")
    contact_phone: Mapped[str] = mapped_column(String(20))
    notes: Mapped[str] = mapped_column(String(500), default="")
    rate_version_id: Mapped[int] = mapped_column(ForeignKey("rate_versions.id"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    delivered_at: Mapped[datetime | None]
    release_at: Mapped[datetime | None]
    closed_at: Mapped[datetime | None]

    member: Mapped[Member] = relationship(lazy="joined")
    rate_version: Mapped[RateVersion] = relationship()
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.id", lazy="selectin"
    )
    history: Mapped[list[OrderStatusLog]] = relationship(
        cascade="all, delete-orphan", order_by="OrderStatusLog.id", lazy="selectin"
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("qty > 0"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    name: Mapped[str] = mapped_column(String(150))
    unit_price: Mapped[int]
    qty: Mapped[int]

    order: Mapped[Order] = relationship(back_populates="items")


class OrderStatusLog(Base):
    __tablename__ = "order_status_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    status: Mapped[OrderStatus] = mapped_column(String(12))
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    note: Mapped[str] = mapped_column(String(300), default="")
    at: Mapped[datetime] = mapped_column(default=utcnow)


class Earning(Base):
    """One row per (order, upline member). Pending until the return window ends."""

    __tablename__ = "earnings"
    __table_args__ = (UniqueConstraint("order_id", "member_id"), Index("ix_earnings_member", "member_id", "status"))

    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    program: Mapped[Program] = mapped_column(String(10))
    level: Mapped[int]
    rate_bp: Mapped[float]
    amount: Mapped[int]
    status: Mapped[EarningStatus] = mapped_column(String(10), default=EarningStatus.PENDING)
    release_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Withdrawal(Base):
    __tablename__ = "withdrawals"
    __table_args__ = (CheckConstraint("amount > 0"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    amount: Mapped[int]
    method: Mapped[str] = mapped_column(String(30))
    account: Mapped[str] = mapped_column(String(100))
    status: Mapped[WithdrawalStatus] = mapped_column(String(10), default=WithdrawalStatus.REQUESTED)
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    decided_at: Mapped[datetime | None]
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))

    member: Mapped[Member] = relationship(lazy="joined")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(500))
    read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id"))
    action: Mapped[str] = mapped_column(String(40))
    entity: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[int | None]
    details: Mapped[str] = mapped_column(Text, default="{}")
    at: Mapped[datetime] = mapped_column(default=utcnow)

    admin: Mapped[Admin | None] = relationship(lazy="joined")
