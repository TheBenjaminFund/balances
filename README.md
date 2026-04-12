# Benjamin Fund Investor Portal

A lightweight Node/Express + SQLite portal for private-fund operations.

It includes:
- a public landing page with a manually maintained NAV/share chart
- an investor dashboard with balance history, transaction filtering, and yearly net-deposit reporting
- an admin portal for user management, balance history entry, transaction maintenance, fund NAV maintenance, backups, and investor impersonation

## Core Features

### Public landing page
- branded login experience
- public NAV/share chart with range toggles
- admin-managed fund event markers for notable dates
- mobile-friendly investor/public layout

### Investor dashboard
- account summary with **Total Invested**, **Current NAV**, and return
- balance-history chart with custom tooltips and transaction markers
- net-deposits-by-year bar chart
- transaction table with:
  - type filter
  - year filter
  - newest/oldest sorting
  - amount high/low sorting
- password change flow

### Admin portal
- create investors and reset passwords
- assign custom investor display labels
- sort investor list by label, NAV, invested capital, and return
- maintain weekly/biweekly balance history
- bulk-paste balance history from spreadsheets
- maintain investor transaction ledgers
- maintain public fund NAV/share history
- bulk-paste NAV/share history from spreadsheets
- maintain public fund event markers
- download SQLite backups
- **View as Investor** impersonation mode with one-click return to admin

## Tech Stack
- Node.js
- Express
- SQLite
- Vanilla JavaScript
- HTML/CSS
- JWT auth
- bcrypt password hashing

## Project Structure

```text
.
├── server.js            # Express server, auth, API routes, SQLite setup
├── public/
│   ├── index.html       # Single-page shell
│   ├── app.js           # Frontend rendering and admin/investor logic
│   ├── styles.css       # Main styles
│   ├── theme.css        # Theme variables
│   └── logo.png         # Branding asset
├── .env.sample          # Example environment variables
├── .gitignore           # Recommended ignores for safe sharing
├── package.json
└── README.md
```

## Local Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local env file from the sample:
   ```bash
   cp .env.sample .env
   ```
3. Fill in the required variables.
4. Start the app:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000`

## Environment Variables

The app is designed to read sensitive values from environment variables rather than hardcoding them.

Required:
- `ADMIN_EMAIL` – bootstrap admin email
- `ADMIN_PASSWORD` – bootstrap admin password
- `JWT_SECRET` – long random token-signing secret
- `DATA_DIR` – directory for SQLite persistence

Optional:
- `PORT` – defaults to `3000`

## Render Deployment Notes

This project works well on Render.

Recommended setup:
- put `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `DATA_DIR` in Render's **Environment** tab
- mount a persistent disk and point `DATA_DIR` to that mounted path
- use `npm install` as the build command and `npm start` as the start command

Because secrets live in Render environment variables, the repository can be shared with developers much more safely than if credentials were committed directly.

## Safe Sharing / Handoff Notes

If you want another developer to review or edit the portal, this is the intended workflow:
- share the code repository
- keep secrets in Render environment variables
- do **not** commit the production SQLite database, backups, exports, or uploads

Recommended `.gitignore` entries are included.

If production data was committed in old Git history, that should be cleaned separately before broad sharing.

## API Overview

### Auth
- `POST /api/auth/login`
- `GET /api/me`
- `PATCH /api/me/password`

### Admin: investors
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id/summary`
- `PUT /api/admin/users/:id/balance-history/:year`
- `PUT /api/admin/users/:id/transactions`
- `POST /api/admin/users/:id/reset-password`
- `POST /api/admin/users/:id/impersonate`
- `DELETE /api/admin/users/:id`

### Admin: fund-level data
- `GET /api/admin/fund-nav`
- `PUT /api/admin/fund-nav/history`
- `PUT /api/admin/fund-nav/events`
- `GET /api/admin/backup`

### Settings / public
- `GET /api/admin/last-updated`
- `POST /api/admin/last-updated`
- `GET /api/public-landing`

## Data Notes
- currency values are stored as **integer cents**
- balances are intended to reflect actual manual accounting dates
- transactions drive yearly net deposits automatically
- the latest balance-history row drives current NAV automatically
- fund NAV/share history is maintained separately for the public landing page

## For Developers Jumping In

If you are reviewing this project for the first time, the best entry points are:
- `server.js` for database schema, auth, and route behavior
- `public/app.js` for rendering logic and admin workflow
- `renderAdmin(...)` in `public/app.js` for most admin UX work
- `renderHome(...)`, `renderBalanceSection(...)`, and `renderTransactionsSection(...)` for investor-facing features
- `renderPublicNavSection(...)` for the landing-page NAV/share chart

## Current Priorities / Likely Next Additions
- investor document center
- PDF statement generation
- additional mobile polish
- optional security hardening / sanitized shareable repo mode

