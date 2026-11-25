"""Repository pattern: every query lives here, services only talk to these classes."""

from .auth import AdminRepository, OtpRepository, SessionRepository
from .catalog import CategoryRepository, ProductRepository
from .ledger import EarningRepository, WithdrawalRepository
from .members import MemberRepository
from .misc import AuditRepository, NotificationRepository, ReportRepository
from .orders import OrderRepository
from .settings import RateRepository, SettingsRepository

__all__ = [
    "AdminRepository",
    "AuditRepository",
    "CategoryRepository",
    "EarningRepository",
    "MemberRepository",
    "NotificationRepository",
    "OrderRepository",
    "OtpRepository",
    "ProductRepository",
    "RateRepository",
    "ReportRepository",
    "SessionRepository",
    "SettingsRepository",
    "WithdrawalRepository",
]
