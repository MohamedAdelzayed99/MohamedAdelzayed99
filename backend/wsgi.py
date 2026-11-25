"""WSGI entry point and management commands.

flask --app wsgi run --port 4000          # development server
gunicorn -w 1 -b 0.0.0.0:4000 wsgi:app    # production
flask --app wsgi seed                     # demo data
flask --app wsgi create-admin USER NAME   # password is prompted
flask --app wsgi release                  # release matured earnings (cron alternative)
flask --app wsgi backup                   # nightly backup (cron alternative)
"""

import os

import click

from hightech import create_app
from hightech.config import Config
from hightech.jobs import backup_database, release_matured

config = Config(run_background_jobs=os.environ.get("RUN_JOBS", "1") == "1")
app = create_app(config)
container = app.extensions["hightech"]


@app.cli.command("seed")
def seed_command():
    """Admin user, categories, products, and the example trees from the plan."""
    from scripts.seed import seed

    click.echo(seed(container, os.environ.get("ADMIN_PASSWORD", "hightech-admin")))


@app.cli.command("create-admin")
@click.argument("username")
@click.argument("name")
@click.password_option()
def create_admin_command(username, name, password):
    container.admin_auth.create_admin(username, password, name)
    click.echo(f"Admin {username} created.")


@app.cli.command("release")
def release_command():
    click.echo(f"Released {release_matured(container)} earnings.")


@app.cli.command("backup")
def backup_command():
    click.echo(f"Backup: {backup_database(container)}")
