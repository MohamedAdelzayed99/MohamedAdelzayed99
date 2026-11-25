from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from hightech.domain.errors import (
    AuthenticationError,
    DomainError,
    NotFoundError,
    PermissionDenied,
    RateLimited,
    ValidationError,
)

_STATUS = {
    ValidationError: 400,
    AuthenticationError: 401,
    PermissionDenied: 403,
    NotFoundError: 404,
    RateLimited: 429,
}


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(DomainError)
    def _domain(error: DomainError):
        return jsonify(error=error.code, message=error.message), _STATUS.get(type(error), 400)

    @app.errorhandler(HTTPException)
    def _http(error: HTTPException):
        messages = {
            404: ("not_found", "غير موجود"),
            405: ("method_not_allowed", "غير مسموح"),
            400: ("bad_request", "طلب غير صحيح"),
            413: ("too_large", "الطلب كبير جدًا"),
        }
        code, message = messages.get(error.code or 500, ("error", error.description or "خطأ"))
        return jsonify(error=code, message=message), error.code

    @app.errorhandler(Exception)
    def _unexpected(error: Exception):
        app.logger.exception("unhandled error", exc_info=error)
        return jsonify(error="server_error", message="حدث خطأ، حاول مرة أخرى"), 500
