
# Balance Widget App

Secure login + USD balance display with admin controls, plus an embeddable `<balance-widget>`.

## Quick Start (Local)

```bash
npm install
cp .env.sample .env   # then edit values
npm start
```

Open http://localhost:3000

## Deploy to Render

1. Create a **new GitHub repository** and upload all files in this folder.
2. In Render, choose **New -> Web Service**, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add Environment Variables:
   - `ADMIN_EMAIL` (your admin email)
   - `ADMIN_PASSWORD` (temporary; change after first login)
   - `JWT_SECRET` (random string)
6. Deploy. Visit the URL Render gives you.
7. For embedding, use:

```html
<script src="https://YOUR-APP.onrender.com/widget.js"></script>
<balance-widget data-base-url="https://YOUR-APP.onrender.com"></balance-widget>
```

## API (short)
- `POST /api/auth/register` { email, password } -> token
- `POST /api/auth/login` { email, password } -> token, user, balance_cents
- `GET /api/me` (Bearer token) -> user, balance
- `GET /api/admin/users` (admin) -> list
- `PATCH /api/admin/users/:id/balance` (admin) -> update
- `POST /api/admin/reset-password` (admin) -> set a new password for a user
