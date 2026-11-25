from sqlalchemy import select

from hightech.domain.commission import RateConfig
from hightech.domain.enums import Program
from hightech.infrastructure.models import RateVersion, Setting

from .base import SqlRepository


class SettingsRepository:
    def __init__(self, session):
        self.session = session

    def all(self) -> dict[str, str]:
        return {s.key: s.value for s in self.session.scalars(select(Setting))}

    def raw(self, key: str) -> str | None:
        setting = self.session.get(Setting, key)
        return setting.value if setting else None

    def put(self, key: str, value: str) -> None:
        setting = self.session.get(Setting, key)
        if setting:
            setting.value = value
        else:
            self.session.add(Setting(key=key, value=value))

    def put_missing(self, defaults: dict[str, str]) -> None:
        existing = set(self.all())
        for key, value in defaults.items():
            if key not in existing:
                self.session.add(Setting(key=key, value=value))


class RateRepository(SqlRepository[RateVersion]):
    model = RateVersion

    def current(self, program: Program) -> RateVersion | None:
        stmt = select(RateVersion).where(RateVersion.program == program).order_by(RateVersion.id.desc()).limit(1)
        return self.session.scalar(stmt)

    def history(self, limit: int = 50) -> list[RateVersion]:
        return list(self.session.scalars(select(RateVersion).order_by(RateVersion.id.desc()).limit(limit)))

    def add_version(self, program: Program, rates: RateConfig, admin_id: int | None) -> RateVersion:
        return self.add(
            RateVersion(
                program=program,
                total_bp=rates.total_bp,
                step_bp=rates.step_bp,
                floor_bp=rates.floor_bp,
                created_by=admin_id,
            )
        )

    @staticmethod
    def to_config(version: RateVersion) -> RateConfig:
        return RateConfig(version.total_bp, version.step_bp, version.floor_bp)
