"""Health check and the landing page behind share links (/r/CODE and /w/CODE)."""

import re

from flask import Blueprint, jsonify, render_template

from hightech.domain.enums import Program
from hightech.domain.errors import NotFoundError

from .context import services

bp = Blueprint("public", __name__)


@bp.get("/health")
def health():
    return jsonify(ok=True)


@bp.get("/r/<code>")
def retail_link(code: str):
    return _landing(Program.RETAIL, code)


@bp.get("/w/<code>")
def wholesale_link(code: str):
    return _landing(Program.WHOLESALE, code)


def _landing(program: Program, code: str):
    code = re.sub(r"[^A-Z0-9]", "", code.upper())
    try:
        inviter = services().network.referrer_name(program, code)
    except NotFoundError:
        inviter = None
    key = program.value.upper()
    urls = services().config.store_urls
    return render_template(
        "landing.html",
        app_name="High Tech" if program is Program.RETAIL else "High Tech جملة",
        scheme="hightech" if program is Program.RETAIL else "hightech-wholesale",
        code=code,
        inviter=inviter,
        play_url=urls.get(f"PLAY_URL_{key}", "#"),
        appstore_url=urls.get(f"APPSTORE_URL_{key}", "#"),
    )
