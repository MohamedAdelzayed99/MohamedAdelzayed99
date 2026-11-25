"""Authentication decorators. The authenticated principal is placed on flask.g."""

from functools import wraps

from flask import g, request

from .context import services


def bearer_token() -> str | None:
    header = request.headers.get("Authorization", "")
    return header.removeprefix("Bearer ").strip() or None


def member_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        g.member = services().member_auth.member_for_token(g.program, bearer_token())
        return view(*args, **kwargs)

    return wrapper


def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        g.admin = services().admin_auth.admin_for_token(bearer_token())
        return view(*args, **kwargs)

    return wrapper
