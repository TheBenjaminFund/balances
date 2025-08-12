
# The Benjamin Fund — Investor Portal

- Dark theme + brand accent
- Admin: create/reset/delete users, edit **balances** and **deposits**
- Settings: **Share Price** and **Last Updated** (displayed publicly and to users)
- User view: stats tiles (Balance / Deposits / Performance with % and $)
- CSP-safe (no inline JS)

## Deploy on Render
- **Build:** `npm install`
- **Start:** `npm start`
- **Environment variables:**
  - `ADMIN_EMAIL` — your admin login (e.g. `matthew.benjamin@thebenjaminfund.org`)
  - `ADMIN_PASSWORD` — temp admin password
  - `JWT_SECRET` — long random string

## Endpoints (server)
- `POST /api/auth/login` → `{ token, user, balance_cents, deposit_cents }`
- `GET /api/me` → includes `last_updated`
- Admin users:
  - `GET /api/admin/users`
  - `POST /api/admin/users` (returns password once)
  - `POST /api/admin/users/:id/reset-password`
  - `DELETE /api/admin/users/:id`
  - `PATCH /api/admin/users/:id/balance`
  - `PATCH /api/admin/users/:id/deposit`
- Admin settings:
  - `GET/POST /api/admin/share-price`
  - `GET/POST /api/admin/last-updated`
- Public stats:
  - `GET /api/public-stats` → `{ share_price, last_updated }`

## Embed
```html
<script src="https://YOUR-APP.onrender.com/widget.js"></script>
<balance-widget data-base-url="https://YOUR-APP.onrender.com"></balance-widget>
```
