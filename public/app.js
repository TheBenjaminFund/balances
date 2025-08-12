const baseUrl = window.location.origin;

// Populate embed snippet
const snippetEl = document.getElementById('snippet');
if (snippetEl) {
  snippetEl.textContent =
`<script src="${baseUrl}/widget.js"><\/script>
<balance-widget data-base-url="${baseUrl}"></balance-widget>`;
}

// Admin SPA
const state = { token: null, user: null, users: [] };
const app = document.getElementById('app');

function render() {
  if (!app) return;
  app.innerHTML = '';
  
  if (!state.token) {
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="grid">
        <div>
          <label>Email</label>
          <input id="email" placeholder="you@example.com" />
        </div>
        <div>
          <label>Password</label>
          <input id="password" type="password" placeholder="••••••••" />
        </div>
      </div>
      <div style="margin-top:12px">
        <button type="submit">Login</button>
      </div>`;
    
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = form.querySelector('#email').value.trim();
      const password = form.querySelector('#password').value;
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (r.ok) {
        state.token = data.token;
        state.user = data.user;
        render();
        fetchUsers();
      } else {
        alert(data.error || 'Login failed');
      }
    };
    app.appendChild(form);
    return;
  }

  const hdr = document.createElement('div');
  hdr.className = 'row';
  hdr.innerHTML = `
    <div class="badge">Logged in as ${state.user.email} (${state.user.role})</div>
    <div style="flex:1"></div>
    <button id="logout">Log out</button>`;
  hdr.querySelector('#logout').onclick = () => {
    state.token = null;
    state.user = null;
    state.users = [];
    render();
  };
  app.appendChild(hdr);

  const tableWrap = document.createElement('div');
  tableWrap.style.marginTop = '16px';
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Balance</th><th>Update</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table>`;
  app.appendChild(tableWrap);

  const tbody = tableWrap.querySelector('#tbody');
  for (const u of state.users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.role}</td>
      <td>$${(u.balance_cents / 100).toFixed(2)}</td>
      <td>
        <div class="row">
          <input style="max-width:140px" placeholder="New balance (USD)" id="b${u.id}" />
          <button id="s${u.id}">Save</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
    tr.querySelector('#s' + u.id).onclick = async () => {
      const usd = parseFloat(tr.querySelector('#b' + u.id).value);
      if (Number.isNaN(usd)) return alert('Enter a number');
      const r = await fetch('/api/admin/users/' + u.id + '/balance', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + state.token
        },
        body: JSON.stringify({ balance_cents: Math.round(usd * 100) })
      });
      if (r.ok) fetchUsers();
      else alert('Update failed');
    };
  }
}

async function fetchUsers() {
  const r = await fetch('/api/admin/users', {
    headers: { 'Authorization': 'Bearer ' + state.token }
  });
  if (r.ok) state.users = await r.json();
  render();
}

render();
