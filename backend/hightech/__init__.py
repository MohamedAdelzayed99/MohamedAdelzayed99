"""High Tech API — Flask application factory."""

from __future__ import annotations

import logging

from flask import Flask, request

from hightech.config import Config
from hightech.container import Container, build_container


def create_app(config: Config | None = None, container: Container | None = None) -> Flask:
    config = config or (container.config if container else Config())
    container = container or build_container(config)

    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    app.extensions["hightech"] = container
    logging.basicConfig(level=logging.INFO)

    from hightech.api.admin_routes import bp as admin_bp
    from hightech.api.errors import register_error_handlers
    from hightech.api.member_routes import bp as member_bp
    from hightech.api.public_routes import bp as public_bp

    app.register_blueprint(public_bp)
    app.register_blueprint(member_bp)
    app.register_blueprint(admin_bp)
    register_error_handlers(app)

    @app.after_request
    def _cors(response):
        # The dashboard and Expo web run on other origins during development.
        response.headers["Access-Control-Allow-Origin"] = config.cors_origin
        response.headers["Access-Control-Allow-Headers"] = "authorization, content-type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        return response

    @app.before_request
    def _preflight():
        if request.method == "OPTIONS":
            return "", 204
        return None

    if config.run_background_jobs:
        from hightech.jobs import start_background_jobs

        start_background_jobs(container)
    return app
