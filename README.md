# High Tech — Retail & Wholesale referral apps

This repo implements the **High Tech** sales & referral system from the plan document (`HighTech-App-Plan.pdf`):

| Part | Folder | What it is |
|---|---|---|
| Commission engine | `packages/commission` | Pure TypeScript calculation of the retail 30% and wholesale 5% splits, shared by every part |
| Backend API | `server` | Node.js + Express + SQLite. It holds the only copy of balances, orders and the tree that counts |
| Admin dashboard | `admin` | Vite + React (Arabic, RTL). Manages products, orders, accounts, rates, withdrawals, reports |
| Mobile apps | `mobile` | One Expo (React Native) codebase that builds **two store apps**: `APP_VARIANT=retail` and `APP_VARIANT=wholesale` |

## Quick start

```bash
npm install
npm test                                   # engine tests + end-to-end API tests

# backend
cd server
npm run seed                               # admin user + sample products + the example trees from the sheets
DEV_OTP=1 npm run dev                      # http://localhost:4000 (DEV_OTP=1 returns the SMS code in the API response)

# dashboard (new terminal)
npm run dev -w @hightech/admin             # login: admin / hightech-admin (set ADMIN_PASSWORD before seeding)

# mobile (new terminal)
cd mobile
APP_VARIANT=retail npx expo start          # retail app
APP_VARIANT=wholesale npx expo start       # wholesale app
```

Environment variables (server): `PORT`, `DB_PATH`, `PUBLIC_URL` (domain used in share links), `DEV_OTP`, `PUSH_ENABLED`,
`BACKUP_DIR`, `CORS_ORIGIN`, `PLAY_URL_RETAIL`, `APPSTORE_URL_RETAIL`, `PLAY_URL_WHOLESALE`, `APPSTORE_URL_WHOLESALE`.
Mobile: `EXPO_PUBLIC_API_URL`. Dashboard: `VITE_API_URL`.

## How commissions work (plan sections 2–3)

`n` = number of people above the buyer. The direct link owner gets `max(total − step × (n − 1), floor)`;
the rest of the total is split equally among everyone else above.

| | total | step | floor |
|---|---|---|---|
| Retail (cash commission) | 30% | 5% | 10% |
| Wholesale (discount credit) | 5% | 1% | 3% |

Every example in the plan is a unit test in `packages/commission/src/index.test.ts`
(e.g. «4.1» buys for 1,000 EGP → 100 / 50 / 50 / 50 / 50; 11 above → 100 + 10 × 20;
wholesale 10,000 EGP invoice → 500, or 300 + 100 + 100, or 300 + 5 × 40).

Money is stored in piastres and rates in basis points, so all the arithmetic uses whole numbers. Sub-piastre remainders stay with the company.

## Protection rules (plan section 4) and where they live

- **Earnings are created only when an order is delivered and paid**, as *pending*. They become *available* when the
  return window ends (`releaseMatured`, runs every 10 min). A return inside the window cancels them. → `server/src/orders.ts`
- **One account per phone number per app**, and a person's place in the tree is fixed. Only the dashboard can move someone, every move is written to the audit log, and moves that would create a loop are refused. → `server/src/members.ts`
- **Orders that are unpaid, cancelled or not delivered pay no commission.**
- **Rates can be edited at any time**, but each order keeps the rate version it was placed with, so changes only affect new orders. → `rate_versions` table
- **Withdrawals happen only on request and need admin approval.** There is a minimum amount and only one open request at a time. A rejected request goes back to the balance. → `server/src/wallet.ts`
- **No subscription fees.** Money is only earned from real product sales.
- Balances are never stored. They are worked out from the ledger every time, so no phone can change a balance.
- The wholesale price never appears in the retail API, and each app has its own tree, login and referral codes.
- The database is copied to a nightly backup with `VACUUM INTO` (`BACKUP_DIR`).

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

- An SMS provider for the OTP codes. Implement the `SmsSender` interface in `server/src/members.ts`
- Paymob integration (webhook → `markPaid`)
- The domain for share links (`PUBLIC_URL`) plus Android App Links / iOS Universal Links
- Logo, colours and the product list with images
- Apple Developer and Google Play accounts in the company's name, then EAS builds for both variants
- Terms & conditions reviewed by a lawyer
- Production hosting (any Node 22 host with a persistent disk, behind HTTPS)
