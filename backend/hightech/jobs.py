"""Periodic jobs: release matured earnings and back up the database nightly (plan section 6).

They run in a daemon thread for single-process deployments. With several workers, set
RUN_JOBS=0 on all but one, or call `flask --app wsgi release` / `backup` from cron instead.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

from hightech.container import Container

log = logging.getLogger(__name__)
RELEASE_EVERY_SECONDS = 10 * 60


def release_matured(container: Container) -> int:
    released = container.orders.release_matured()
    if released:
        log.info("[release] %s earnings are now available", released)
    return released


def backup_database(container: Container) -> Path | None:
    """Consistent SQLite snapshot with VACUUM INTO. (For PostgreSQL use the provider's managed backups.)"""
    if (
        not container.config.database_url.startswith("sqlite:///")
        or container.config.database_url == "sqlite:///:memory:"
    ):
        log.info("[backup] skipped: only file-based SQLite is backed up by the app")
        return None
    target_dir = Path(container.config.backup_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"hightech-{container.clock.now():%Y-%m-%d}.db"
    if target.exists():
        return target
    with container.engine.connect() as connection:  # type: ignore[attr-defined]
        connection.exec_driver_sql("VACUUM INTO ?", (str(target),))
    log.info("[backup] written to %s", target)
    return target


def start_background_jobs(container: Container) -> threading.Thread:
    def loop() -> None:
        while True:
            try:
                release_matured(container)
                if container.clock.now().hour == 0:  # ~2am Cairo
                    backup_database(container)
            except Exception:
                log.exception("background job failed")
            time.sleep(RELEASE_EVERY_SECONDS)

    thread = threading.Thread(target=loop, name="hightech-jobs", daemon=True)
    thread.start()
    return thread
