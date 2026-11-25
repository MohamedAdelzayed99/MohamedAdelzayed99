# High Tech — Retail & Wholesale referral apps

This repo implements the **High Tech** sales & referral system from the plan document (`HighTech-App-Plan.pdf`):

| Part | Folder | What it is |
|---|---|---|
| Backend API | `backend` | **Python / Flask**, layered (domain → services → repositories), SQLAlchemy. It holds the only copy of balances, orders and the tree that counts. See [`backend/README.md`](backend/README.md) for the architecture and design patterns |
| Commission engine (JS) | `packages/commission` | TypeScript copy of the rules, used by the dashboard (rate preview) and the apps (money formatting). The backend's Python `CommissionPolicy` is the one that counts |
| Admin dashboard | `admin` | Vite + React (Arabic, RTL). Manages products, orders, accounts, rates, withdrawals, reports |
| Mobile apps | `mobile` | One Expo (React Native) codebase that builds **two store apps**: `APP_VARIANT=retail` and `APP_VARIANT=wholesale` |

## Quick start

```bash
npm install

# backend (Python 3.11+)
cd backend
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
flask --app wsgi seed                      # admin user + sample products + the example trees from the sheets
DEV_OTP=1 flask --app wsgi run --port 4000 # DEV_OTP=1 returns the SMS code in the API response
pytest                                     # 87 tests: every example in the plan + end-to-end API scenarios

# dashboard (new terminal)
npm run dev -w @hightech/admin             # login: admin / hightech-admin (set ADMIN_PASSWORD before seeding)

# mobile (new terminal)
cd mobile
EXPO_PUBLIC_APP_VARIANT=retail npx expo start      # retail app
EXPO_PUBLIC_APP_VARIANT=wholesale npx expo start   # wholesale app
```

Backend environment variables are listed in `backend/README.md`. Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_APP_VARIANT`. Dashboard: `VITE_API_URL`.

## How commissions work (plan sections 2–3)

`n` = number of people above the buyer. The direct link owner gets `max(total − step × (n − 1), floor)`;
the rest of the total is split equally among everyone else above.

| | total | step | floor |
|---|---|---|---|
| Retail (cash commission) | 30% | 5% | 10% |
| Wholesale (discount credit) | 5% | 1% | 3% |

Every example in the plan is a unit test in `backend/tests/test_commission.py` (and mirrored in `packages/commission/src/index.test.ts`)
(e.g. «4.1» buys for 1,000 EGP → 100 / 50 / 50 / 50 / 50; 11 above → 100 + 10 × 20;
wholesale 10,000 EGP invoice → 500, or 300 + 100 + 100, or 300 + 5 × 40).

Money is stored in piastres and rates in basis points, so all the arithmetic uses whole numbers. Sub-piastre remainders stay with the company.

## Protection rules (plan section 4) and where they live

- **Earnings are created only when an order is delivered and paid**, as *pending*. They become *available* when the
  return window ends (runs every 10 min). A return inside the window cancels them. → `backend/hightech/services/order_service.py`
- **One account per phone number per app**, and a person's place in the tree is fixed. Only the dashboard can move someone, every move is written to the audit log, and moves that would create a loop are refused. → `backend/hightech/services/network_service.py`
- **Orders that are unpaid, cancelled or not delivered pay no commission.**
- **Rates can be edited at any time**, but each order keeps the rate version it was placed with, so changes only affect new orders. → `RateVersion` table
- **Withdrawals happen only on request and need admin approval.** There is a minimum amount and only one open request at a time. A rejected request goes back to the balance. → `backend/hightech/services/wallet_service.py`
- **No subscription fees.** Money is only earned from real product sales.
- Balances are never stored. They are worked out from the ledger every time, so no phone can change a balance.
- The wholesale price never appears in the retail API, and each app has its own tree, login and referral codes.
- The database is copied to a nightly backup (`BACKUP_DIR`, or `flask --app wsgi backup` from cron).

## Defaults chosen for the open questions (plan section 10)

The plan's questions are still open, so these defaults are in place. Each one can be changed from the dashboard (**الإعدادات / النسب**) with no code change:

| # | Question | Current default |
|---|---|---|
| 1 | The “6 months” on the wholesale sheet | **Not implemented yet.** The answer changes the calculation, so it needs your answer |
| 2 | % of selling price or of margin? | Selling price of the goods (subtotal, before shipping/discount credit) |
| 3 | Wholesale discount: cash or credit? | Credit on future invoices (`wholesale_cash_out = false`) |
| 4 | Retail payout | Vodafone Cash / InstaPay / bank transfer, minimum 100 EGP, on request |
| 5 | Signing up without a link | Becomes a top-level member, or goes under `default_sponsor_*` if one is set. The dashboard can create top-level members such as م. خالد |
| 6 | Earn from own purchase? | No |
| 7 | Same person in both apps? | Yes, as separate accounts in separate trees |
| 8 | Shop registration | Shop name + address (commercial register optional), activated after admin approval |
| 9 | Return window | 14 days |
| 10 | Network visibility | Names of level 1 only, counts and earnings for deeper levels (`network_names_depth`) |
| 11 | Inactive members | They keep earning (no rule yet) |
| 12 | Shipping | Flat fee per app (retail 50 EGP, wholesale 0) |
| 13 | Payment | Cash on delivery. Card and wallet payments can be added once the Paymob account exists (`payment_methods_*`, `/api/admin/orders/:id/paid`) |

## Still needed before launch (plan section 8)

- An SMS provider for the OTP codes. Implement the `SmsSender` interface in `backend/hightech/infrastructure/gateways.py` and wire it in `container.py`
- Paymob integration (webhook → `OrderService.mark_paid`)
- The domain for share links (`PUBLIC_URL`) plus Android App Links / iOS Universal Links
- Logo, colours and the product list with images
- Apple Developer and Google Play accounts in the company's name, then EAS builds for both variants
- Terms & conditions reviewed by a lawyer
- Production hosting: the `backend/Dockerfile` (gunicorn) on any host with a persistent disk, behind HTTPS (or PostgreSQL via `DATABASE_URL`)
