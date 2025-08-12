
# The Benjamin Fund – Balance App (v3)

What's new:
- **Deposits** per user (admin can set)
- **Performance %** shown to users = (Balance - Deposits) / Deposits
- Bigger balance emphasis
- Last Updated date (admin-set) still supported
- RBAC, CSP-safe, and Benjamin Fund theme

## Deploy
1) `npm install`
2) Set env vars in Render: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`
3) `npm start`

## Notes
- For existing deployments: the app auto-adds `deposit_cents` to the `users` table if missing.
