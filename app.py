"""Hvernig eignast ég hús? — a calculator for saving up for and paying off a home.

The server only renders the page; every calculation runs in the browser
(static/calc.js) so the results update as the user moves the sliders. The
current inputs are kept in the URL query string, so a result can be shared.
"""

import os

from flask import Flask, render_template
from werkzeug.middleware.proxy_fix import ProxyFix

# URL prefix for reverse proxy deployment, e.g. "/hus"
PREFIX = os.getenv("PREFIX", "").rstrip("/")


def load_config() -> dict:
    return {
        "PREFIX": PREFIX,
        "SITE_NAME": os.getenv("SITE_NAME", "Hvernig eignast ég hús?"),
    }


def create_app(overrides: dict | None = None) -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    app.config.update(load_config())
    if overrides:
        app.config.update(overrides)

    prefix = app.config["PREFIX"]
    if prefix:
        app.config["APPLICATION_ROOT"] = prefix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

        class PrefixMiddleware:
            def __init__(self, app, prefix: str):
                self.app = app
                self.prefix = prefix

            def __call__(self, environ, start_response):
                script_name = self.prefix
                path_info = environ.get("PATH_INFO", "")
                if path_info.startswith(script_name):
                    environ["SCRIPT_NAME"] = script_name
                    environ["PATH_INFO"] = path_info[len(script_name):] or "/"
                return self.app(environ, start_response)

        app.wsgi_app = PrefixMiddleware(app.wsgi_app, prefix)

    app.jinja_env.globals.update(site_name=app.config["SITE_NAME"])

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        return resp

    @app.route("/")
    def home():
        return render_template("home.html")

    return app
