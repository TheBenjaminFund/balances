# Benjamin Fund – Investor Portal

A lightweight Node/Express + SQLite web app for investors to view balances and performance, with an admin portal to manage users and update figures.

## What’s Included
- **Share price removed** entirely (backend + frontend).
- **User password change** flow (`PATCH /api/me/password`) + UI card.
- **2024 Results** on the investor dashboard:
  - 2024 Deposits, 2024 Ending Balance, 2024 Performance ($ and %)
  - Clearly labeled as 2024-only (separate from overall totals)
- **Admin UI** polish:
  - Users table shows **Balance**, **Deposit**, **2024 Deposits**, **2024 Ending**
  - Inline editors for totals + 2024 fields; Reset Password; Delete
- **Money formatting** with commas/currency via `Intl.NumberFormat`.
- **Persistence**: stores SQLite at `DATA_DIR` so data survives restarts.

## Local Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` from the sample and fill in values:
   ```bash
   cp .env.sample .env
   # edit .env
   ```
3. Run the server:
   ```bash
   npm start
   # open http://localhost:3000
   ```

### Required Environment Variables
(See `.env.sample` for a template.)
- `ADMIN_EMAIL` – bootstrap admin email (created at first run if missing)
- `ADMIN_PASSWORD` – initial admin password
- `JWT_SECRET` – long random string for signing tokens
- `DATA_DIR` – path for SQLite persistence (e.g., `./data` locally or `/var/data` on Render)
- Optional: `PORT` – defaults to 3000

## Deploying to Render
1. Create a **Web Service**.
2. **Environment Variables** (Settings → Environment):
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`
   - `DATA_DIR=/var/data`
3. **Disks**: add a persistent disk mounted at `/var/data` (matches `DATA_DIR`).
4. Build command: `npm install` (default)  
   Start command: `npm start`
5. Node version is controlled via `package.json` (`"engines": { "node": "20.x" }`).  
   A separate `.node-version` file is **not required**.

## API Overview

### Auth & Profile
- `POST /api/auth/login` → `{ token, user, balance_cents, deposit_cents, year_2024_* }`
- `GET /api/me` (auth) → user + balances
- `PATCH /api/me/password` (auth) → body `{ current_password, new_password }`

### Admin – Users (auth + admin)
- `GET /api/admin/users`
- `POST /api/admin/users` → create user (optional `password` to set explicit)
- `POST /api/admin/users/:id/reset-password` → returns `{ password: <temp> }`
- `DELETE /api/admin/users/:id`
- `PATCH /api/admin/users/:id/balance` → `{ balance_cents }`
- `PATCH /api/admin/users/:id/deposit` → `{ deposit_cents }`
- `PATCH /api/admin/users/:id/year/2024` → `{ deposits_cents?, ending_balance_cents? }` (either or both)

### Admin – Settings (auth + admin)
- `GET /api/admin/last-updated` → `{ last_updated }`
- `POST /api/admin/last-updated` → `{ last_updated }` (upsert)

### Public
- `GET /api/public-stats` → `{ last_updated }`

## Data Model
Table `users`:
- `id`, `email`, `password_hash`, `role`
- `balance_cents`, `deposit_cents`
- `year_2024_deposits_cents`, `year_2024_ending_balance_cents`
- `created_at` (ISO UTC)

Table `settings`:
- `key` (PK), `value`

## Notes & Conventions
- **Currency** values are stored as **cents** (integers) to avoid floating-point errors.
- The UI accepts USD strings; the client converts to cents for the API.
- The admin user is created at first boot if it doesn’t exist (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`).

## Changelog Highlights
- Removed share price (all routes, queries, and UI).
- Added password change for users.
- Added 2024 stats (fields, endpoint, and UI tiles).
- Money formatting improvements and UI polish.
