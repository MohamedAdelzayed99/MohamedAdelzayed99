import hashlib
import secrets

from werkzeug.security import check_password_hash, generate_password_hash

_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def otp_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def referral_code(prefix: str) -> str:
    return prefix + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def check_password(password: str, hashed: str) -> bool:
    return check_password_hash(hashed, password)
