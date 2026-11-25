"""Configuration from environment variables (12-factor)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _flag(name: str) -> bool:
    return os.environ.get(name, "") in ("1", "true", "yes")


@dataclass(frozen=True)
class Config:
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", "sqlite:///hightech.db"))
    public_url: str = field(
        default_factory=lambda: os.environ.get("PUBLIC_URL", "https://hightech.example").rstrip("/")
    )
    dev_otp: bool = field(default_factory=lambda: _flag("DEV_OTP"))
    push_enabled: bool = field(default_factory=lambda: _flag("PUSH_ENABLED"))
    cors_origin: str = field(default_factory=lambda: os.environ.get("CORS_ORIGIN", "*"))
    backup_dir: str = field(default_factory=lambda: os.environ.get("BACKUP_DIR", "backups"))
    store_urls: dict[str, str] = field(
        default_factory=lambda: {
            key: os.environ.get(key, "#")
            for key in ("PLAY_URL_RETAIL", "APPSTORE_URL_RETAIL", "PLAY_URL_WHOLESALE", "APPSTORE_URL_WHOLESALE")
        }
    )
    run_background_jobs: bool = True
    testing: bool = False


def test_config(**overrides) -> Config:
    defaults = {
        "database_url": "sqlite://",
        "dev_otp": True,
        "push_enabled": False,
        "run_background_jobs": False,
        "testing": True,
    }
    return Config(**{**defaults, **overrides})
