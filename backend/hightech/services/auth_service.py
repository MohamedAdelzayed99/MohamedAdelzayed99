from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from hightech.domain.enums import MemberStatus, Program
from hightech.domain.errors import AuthenticationError, PermissionDenied, RateLimited, ValidationError
from hightech.domain.phone import normalize_phone
from hightech.infrastructure.clock import Clock
from hightech.infrastructure.gateways import SmsSender
from hightech.infrastructure.models import Admin, Member, OtpCode
from hightech.infrastructure.security import check_password, hash_password, new_token, otp_code, referral_code, sha256
from hightech.infrastructure.unit_of_work import UnitOfWork, UnitOfWorkFactory

from .settings_service import load_settings

MEMBER_SESSION_DAYS = 180
ADMIN_SESSION_DAYS = 7


@dataclass(frozen=True)
class OtpPolicy:
    ttl: timedelta = timedelta(minutes=5)
    resend_after: timedelta = timedelta(seconds=60)
    max_attempts: int = 5


@dataclass(frozen=True)
class OtpRequested:
    phone: str
    is_new_user: bool
    dev_code: str | None


@dataclass(frozen=True)
class SignupData:
    phone: str
    code: str
    name: str | None = None
    referral_code: str | None = None
    shop_name: str | None = None
    shop_address: str | None = None
    commercial_reg: str | None = None


@dataclass(frozen=True)
class LoginResult:
    token: str
    is_new: bool
    member: Member


class MemberAuthService:
    """Phone + one-time code login. A first successful login creates the account under its referrer."""

    def __init__(
        self,
        uow_factory: UnitOfWorkFactory,
        sms: SmsSender,
        clock: Clock,
        expose_dev_code: bool = False,
        policy: OtpPolicy = OtpPolicy(),
    ):
        self._uow = uow_factory
        self._sms = sms
        self._clock = clock
        self._expose_dev_code = expose_dev_code
        self._policy = policy

    def request_otp(self, program: Program, raw_phone: object) -> OtpRequested:
        phone = normalize_phone(raw_phone)
        now = self._clock.now()
        code = otp_code()
        with self._uow() as uow:
            previous = uow.otps.get(program, phone)
            if previous and previous.sent_at > now - self._policy.resend_after:
                raise RateLimited("otp_too_soon", "انتظر دقيقة قبل طلب كود جديد")
            uow.otps.save(
                OtpCode(
                    program=program,
                    phone=phone,
                    code_hash=sha256(phone + code),
                    expires_at=now + self._policy.ttl,
                    attempts=0,
                    sent_at=now,
                )
            )
            is_new = uow.members.by_phone(program, phone) is None
            uow.commit()
        self._sms.send(phone, f"High Tech: كود التأكيد {code}")
        return OtpRequested(phone, is_new, code if self._expose_dev_code else None)

    def verify(self, program: Program, data: SignupData) -> LoginResult:
        phone = normalize_phone(data.phone)
        with self._uow() as uow:
            self._check_code(uow, program, phone, data.code)
            member = uow.members.by_phone(program, phone)
            is_new = member is None
            if member is None:
                member = MemberFactory(uow).create(program, phone, data)
            if member.status == MemberStatus.SUSPENDED:
                raise PermissionDenied("الحساب موقوف، تواصل معنا")
            uow.otps.delete(program, phone)
            token = new_token()
            uow.sessions.create(
                sha256(token), "member", member.id, self._clock.now() + timedelta(days=MEMBER_SESSION_DAYS)
            )
            uow.commit()
            return LoginResult(token, is_new, member)

    def _check_code(self, uow: UnitOfWork, program: Program, phone: str, code: str) -> None:
        otp = uow.otps.get(program, phone)
        if otp is None or otp.expires_at < self._clock.now():
            raise ValidationError("otp_expired", "الكود انتهى، اطلب كودًا جديدًا")
        if otp.attempts >= self._policy.max_attempts:
            raise ValidationError("otp_locked", "محاولات كثيرة، اطلب كودًا جديدًا")
        if otp.code_hash != sha256(phone + str(code or "").strip()):
            otp.attempts += 1
            uow.commit()  # the failed attempt must count even though we raise
            raise ValidationError("otp_wrong", "الكود غير صحيح")

    def member_for_token(self, program: Program, token: str | None) -> Member:
        if not token:
            raise AuthenticationError()
        with self._uow() as uow:
            member_id = uow.sessions.subject(sha256(token), "member", self._clock.now())
            member = uow.members.get(member_id) if member_id else None
            if member is None or member.program != program:
                raise AuthenticationError()
            if member.status == MemberStatus.SUSPENDED:
                raise PermissionDenied("الحساب موقوف", code="suspended")
            return member

    def logout(self, token: str) -> None:
        with self._uow() as uow:
            uow.sessions.revoke(sha256(token))
            uow.commit()


class MemberFactory:
    """Factory: builds a new member with a unique code, its parent resolved and its initial status set."""

    MAX_CODE_ATTEMPTS = 10

    def __init__(self, uow: UnitOfWork):
        self._uow = uow

    def create(self, program: Program, phone: str, data: SignupData) -> Member:
        settings = load_settings(self._uow)
        name = _required(data.name, "name", 80)
        member = Member(
            program=program,
            phone=phone,
            name=name,
            referral_code=self._unique_code(program),
            parent_id=self._resolve_parent(program, data.referral_code, settings.default_sponsor(program)),
            status=MemberStatus.ACTIVE,
        )
        if program is Program.WHOLESALE:
            member.shop_name = _required(data.shop_name, "shopName", 120)
            member.shop_address = _required(data.shop_address, "shopAddress", 300)
            member.commercial_reg = (data.commercial_reg or "").strip()[:60] or None
            if settings.wholesale_requires_approval:
                member.status = MemberStatus.PENDING_APPROVAL
        return self._uow.members.add(member)

    def _resolve_parent(self, program: Program, code: str | None, default_sponsor: int | None) -> int | None:
        code = (code or "").strip().upper()
        if not code:
            return default_sponsor
        parent = self._uow.members.by_referral_code(code)
        if parent is None or parent.program != program:
            raise ValidationError("invalid_referral", "كود الدعوة غير صحيح")
        return parent.id

    def _unique_code(self, program: Program) -> str:
        for _ in range(self.MAX_CODE_ATTEMPTS):
            code = referral_code(program.code_prefix)
            if not self._uow.members.code_exists(code):
                return code
        raise RuntimeError("could not generate a unique referral code")


class AdminAuthService:
    def __init__(self, uow_factory: UnitOfWorkFactory, clock: Clock):
        self._uow = uow_factory
        self._clock = clock

    def login(self, username: object, password: object) -> tuple[str, Admin]:
        with self._uow() as uow:
            admin = uow.admins.by_username(str(username or ""))
            if admin is None or not check_password(str(password or ""), admin.password_hash):
                raise ValidationError("bad_login", "اسم المستخدم أو كلمة المرور غير صحيحة")
            token = new_token()
            uow.sessions.create(
                sha256(token), "admin", admin.id, self._clock.now() + timedelta(days=ADMIN_SESSION_DAYS)
            )
            uow.commit()
            return token, admin

    def admin_for_token(self, token: str | None) -> Admin:
        if not token:
            raise AuthenticationError()
        with self._uow() as uow:
            admin_id = uow.sessions.subject(sha256(token), "admin", self._clock.now())
            admin = uow.admins.get(admin_id) if admin_id else None
            if admin is None:
                raise AuthenticationError()
            return admin

    def create_admin(self, username: str, password: str, name: str) -> Admin:
        if len(password) < 8:
            raise ValidationError("weak_password", "كلمة المرور 8 أحرف على الأقل")
        with self._uow() as uow:
            admin = uow.admins.add(Admin(username=username, password_hash=hash_password(password), name=name))
            uow.commit()
            return admin


def _required(value: str | None, field: str, max_len: int) -> str:
    value = (value or "").strip() if isinstance(value, str) or value is None else ""
    if not value or len(value) > max_len:
        raise ValidationError(f"invalid_{field}", f"قيمة غير صحيحة: {field}")
    return value
