
# The Benjamin Fund – Balance App (Full Package)

## What’s included
- Benjamin Fund theme (#1e1e1e / #ffffff / #04a156)
- Admin: Create user (returns password once), Reset password (six digits), Delete user
- RBAC: Users see only their own balance; Admin sees full controls
- CSP-safe (all JS external)

## Deploy on Render
- Build: `npm install`
- Start: `npm start`
- Env vars: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`

## Embed
After deploy, copy the snippet shown on the homepage, or:
```html
<script src="https://YOUR-APP.onrender.com/widget.js"></script>
<balance-widget data-base-url="https://YOUR-APP.onrender.com"></balance-widget>
```
