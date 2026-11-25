# High Tech API (Flask)

The backend for both mobile apps and the admin dashboard.

## Run

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt

flask --app wsgi seed                       # admin / hightech-admin, sample products, the example trees
DEV_OTP=1 flask --app wsgi run --port 4000  # DEV_OTP=1 returns the SMS code in the API response

pytest                                      # unit + end-to-end tests
ruff check . && ruff format --check .       # lint
```

Production: `gunicorn -w 1 --threads 8 -b 0.0.0.0:4000 wsgi:app` (or the `Dockerfile`).

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///hightech.db` | Any SQLAlchemy URL (e.g. PostgreSQL in production) |
| `PUBLIC_URL` | `https://hightech.example` | Domain used in share links (`/r/CODE`, `/w/CODE`) |
| `DEV_OTP` | off | Return the OTP in the response (testing only) |
| `PUSH_ENABLED` | off | Send Expo push notifications |
| `RUN_JOBS` | `1` | Background release + backup thread (set `0` on extra workers and use `flask --app wsgi release` / `backup` from cron) |
| `BACKUP_DIR` | `backups` | Nightly SQLite snapshot folder |
| `CORS_ORIGIN` | `*` | Allowed origin for the dashboard |
| `PLAY_URL_*`, `APPSTORE_URL_*` | `#` | Store links on the share landing page |

## Architecture

The code is split into layers, and each layer only depends on the ones below it:

```
api/             HTTP: blueprints, request parsing, presenters, auth decorators, error mapping
  │
services/        Use cases (one transaction each): auth, orders, wallet, network, catalog, settings, reports
  │
domain/          Pure business rules: commission policy, order state machine, events, enums, errors
  │
infrastructure/  SQLAlchemy models, repositories, unit of work, gateways (SMS, push), clock, security
```

`container.py` is the composition root, and `create_app()` in `hightech/__init__.py` is the application factory.

### Design patterns used

| Pattern | Where | Why |
|---|---|---|
| Application Factory | `create_app()` | One app per config, so tests get an isolated app with an in-memory database |
| Dependency Injection / Composition Root | `container.py` | Services receive their dependencies through their constructors, and only this file wires concrete classes together |
| Repository | `infrastructure/repositories/` | Every query lives here, so services never write SQL |
| Unit of Work | `infrastructure/unit_of_work.py` | One transaction per use case. Events are published only after a commit |
| Strategy | `CommissionPolicy(RateConfig)`, `SmsSender`, `PushSender`, `Clock` | Rates are versioned per program. SMS, push and time can be swapped without touching services |
| State machine | `domain/order_state.py` | Only valid order transitions are allowed (placed → confirmed → shipped → delivered → returned, or cancelled) |
| Observer (domain events) | `domain/events.py`, `NotificationService` | Orders and the wallet raise events, and notifications react to them, so services don't know how users are notified |
| Factory | `MemberFactory` | Creating a member: unique referral code, parent resolution, approval status |
| Presenter | `api/presenters.py` | Database models are kept apart from the JSON contract. Wholesale prices never reach the retail app |
| Value objects | `RateConfig`, `Share`, `Balances`, `Checkout` | Immutable, validated on creation |

### Business rules (plan section 4)

- Earnings are created only when a paid order is delivered. They are *pending* until the return window ends, and a return cancels them.
- Balances are computed from the ledger and never stored, so they can't be edited directly.
- Each order keeps the rate version it was placed with, so rate changes only affect new orders.
- Moving someone in the tree is done from the dashboard only. Every move is audited, and loops are refused.
- Withdrawals: there is a minimum amount, only one open request at a time, and the admin approves → pays. Rejecting a request returns the money.
- SQLite writes start with `BEGIN IMMEDIATE`, so balance checks and stock updates can't race.
