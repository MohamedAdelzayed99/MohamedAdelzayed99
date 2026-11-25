"""Composition root: the only place that knows which concrete classes are wired together (DI)."""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial

from hightech.config import Config
from hightech.domain.events import EventBus
from hightech.infrastructure.clock import Clock, SystemClock
from hightech.infrastructure.database import create_db_engine, create_session_factory
from hightech.infrastructure.gateways import ConsoleSmsSender, ExpoPushSender, NullPushSender, PushSender, SmsSender
from hightech.infrastructure.unit_of_work import UnitOfWork
from hightech.services.auth_service import AdminAuthService, MemberAuthService
from hightech.services.catalog_service import CatalogService
from hightech.services.network_service import MemberAdminService, NetworkService
from hightech.services.notification_service import NotificationService
from hightech.services.order_service import OrderService
from hightech.services.report_service import ReportService
from hightech.services.settings_service import RatesService, SettingsService
from hightech.services.wallet_service import WalletService


@dataclass
class Container:
    config: Config
    clock: Clock
    uow: partial
    member_auth: MemberAuthService
    admin_auth: AdminAuthService
    catalog: CatalogService
    network: NetworkService
    member_admin: MemberAdminService
    orders: OrderService
    wallet: WalletService
    notifications: NotificationService
    settings: SettingsService
    rates: RatesService
    reports: ReportService
    engine: object


def build_container(
    config: Config, clock: Clock | None = None, sms: SmsSender | None = None, push: PushSender | None = None
) -> Container:
    clock = clock or SystemClock()
    sms = sms or ConsoleSmsSender()
    push = push or (ExpoPushSender() if config.push_enabled else NullPushSender())

    engine = create_db_engine(config.database_url)
    bus = EventBus()
    uow_factory = partial(UnitOfWork, create_session_factory(engine), bus)

    notifications = NotificationService(uow_factory, push)
    notifications.subscribe(bus)
    settings = SettingsService(uow_factory)
    settings.ensure_defaults()

    return Container(
        config=config,
        clock=clock,
        uow=uow_factory,
        member_auth=MemberAuthService(uow_factory, sms, clock, expose_dev_code=config.dev_otp),
        admin_auth=AdminAuthService(uow_factory, clock),
        catalog=CatalogService(uow_factory),
        network=NetworkService(uow_factory),
        member_admin=MemberAdminService(uow_factory),
        orders=OrderService(uow_factory, clock),
        wallet=WalletService(uow_factory, clock),
        notifications=notifications,
        settings=settings,
        rates=RatesService(uow_factory),
        reports=ReportService(uow_factory),
        engine=engine,
    )
