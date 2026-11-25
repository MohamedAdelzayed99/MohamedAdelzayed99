"""Domain error hierarchy. The API layer maps each type to an HTTP status (see api/errors.py)."""


class DomainError(Exception):
    """Base class. `code` is machine-readable; the message is shown to users (Arabic)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ValidationError(DomainError):
    pass


class NotFoundError(DomainError):
    def __init__(self, message: str = "غير موجود"):
        super().__init__("not_found", message)


class PermissionDenied(DomainError):
    def __init__(self, message: str = "غير مسموح", code: str = "forbidden"):
        super().__init__(code, message)


class AuthenticationError(DomainError):
    def __init__(self, message: str = "سجّل الدخول من جديد"):
        super().__init__("unauthorized", message)


class RateLimited(DomainError):
    pass
