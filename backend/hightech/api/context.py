from flask import current_app

from hightech.container import Container


def services() -> Container:
    return current_app.extensions["hightech"]
