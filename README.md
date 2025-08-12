
# The Benjamin Fund – Balance App

Admin can create users and edit balances. Users log in via an embeddable widget.

## Deploy (Render)
- Build: `npm install`
- Start: `npm start`
- Env:
  - `ADMIN_EMAIL`
  - `ADMIN_PASSWORD`
  - `JWT_SECRET`

## Embedding
Use the snippet shown on the home page after deploy, or:
```html
<script src="https://YOUR-APP.onrender.com/widget.js"></script>
<balance-widget data-base-url="https://YOUR-APP.onrender.com"></balance-widget>
```
