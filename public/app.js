
const baseUrl = window.location.origin;

// toast
function toast(msg, ok=true){
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.position='fixed'; t.style.right='16px'; t.style.bottom='16px';
  t.style.padding='10px 14px'; t.style.borderRadius='10px';
  t.style.background = ok ? '#04a156' : '#b3261e';
  t.style.color = '#fff'; t.style.boxShadow='0 8px 20px rgba(0,0,0,.35)';
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 2200);
}

// Populate embed snippet
const snippetEl = document.getElementById('snippet');
if (snippetEl) {
  snippetEl.textContent =
`<script src="${baseUrl}/widget.js"><\/script>
<balance-widget data-base-url="${baseUrl}"></balance-widget>`;
}

// Admin/User SPA with RBAC
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
    form.onsubmit = loginSubmit(form);
    app.appendChild(form);
    return;
  }

  // Shared header
  const hdr = document.createElement('div');
  hdr.className = 'row';
  hdr.innerHTML = `
    <div class="badge">Logged in as ${state.user.email} (${state.user.role})</div>
    <div style="flex:1"></div>
    <button id="logout">Log out</button>`;
  hdr.querySelector('#logout').onclick = () => { state.token=null; state.user=null; state.users=[]; render(); };
  app.appendChild(hdr);

  if (state.user.role !== 'admin') {
    // Non-admin view: read-only balance, refresh button
    const wrap = document.createElement('div');
    wrap.style.marginTop='16px';
    wrap.innerHTML = `
      <div class="row" style="gap:16px; flex-wrap:wrap">
        <div><strong>Your balance:</strong></div>
        <div id="bal" style="font-weight:700">$0.00</div>
        <div><button id="refresh">Refresh</button></div>
      </div>`;
    app.appendChild(wrap);
    const setBal = (cents)=> { wrap.querySelector('#bal').textContent = '$'+(cents/100).toFixed(2); };
    // Fetch current balance
    fetch('/api/me', { headers:{ 'Authorization':'Bearer '+state.token }})
      .then(r=>r.json()).then(d=> setBal(d.balance_cents||0)).catch(()=>{});
    wrap.querySelector('#refresh').onclick = ()=>{
      fetch('/api/me', { headers:{ 'Authorization':'Bearer '+state.token }})
        .then(r=>r.json()).then(d=> setBal(d.balance_cents||0));
    };
    return;
  }

  // ----- Admin-only UI below -----

  // Create User panel
  const add = document.createElement('div');
  add.style.marginTop='16px';
  add.innerHTML = `
    <div class="row" style="gap:16px; flex-wrap:wrap">
      <div style="flex:1; min-width:220px">
        <label>New user email</label>
        <input id="newEmail" placeholder="user@example.com" />
      </div>
      <div style="flex:1; min-width:220px">
        <label>Temp password (six digits recommended)</label>
        <input id="newPass" placeholder="e.g. 482913" />
      </div>
      <div><button id="create">Create user</button></div>
    </div>`;
  app.appendChild(add);

  add.querySelector('#create').onclick = async ()=>{
    const email = add.querySelector('#newEmail').value.trim().toLowerCase();
    const password = add.querySelector('#newPass').value.trim();
    if(!email || !password) return toast('Email and password required', false);
    try{
      const r = await fetch('/api/admin/users', {
        method:'POST',
        headers:{ 'Content-Type': 'application/json', 'Authorization':'Bearer '+state.token },
        body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error || 'Create failed');
      toast(`User created. Password: ${d.password}`);
      add.querySelector('#newEmail').value='';
      add.querySelector('#newPass').value='';
      fetchUsers();
    }catch(e){ toast(e.message, false); }
  };

  // Users table
  const tableWrap = document.createElement('div');
  tableWrap.style.marginTop = '16px';
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Balance</th><th>Update</th><th>Actions</th></tr></thead>
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
          <input style="max-width:160px" placeholder="New balance (USD)" id="b${u.id}" />
          <button id="s${u.id}">Save</button>
        </div>
      </td>
      <td class="row" style="gap:8px">
        <button id="reset${u.id}">Reset PW</button>
        <button id="del${u.id}" style="background:#b3261e">Delete</button>
      </td>`;
    tbody.appendChild(tr);

    tr.querySelector('#s' + u.id).onclick = async () => {
      const val = tr.querySelector('#b' + u.id).value.trim();
      const usd = Number(val.replace(/[^0-9.\-]/g,''));
      if (!Number.isFinite(usd)) return toast('Enter a numeric USD amount', false);
      try{
        const r = await fetch('/api/admin/users/' + u.id + '/balance', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token },
          body: JSON.stringify({ balance_cents: Math.round(usd * 100) })
        });
        const d = await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(d.error || 'Update failed');
        toast('Balance updated');
        fetchUsers();
      }catch(e){ toast(e.message, false); }
    };

    tr.querySelector('#reset'+u.id).onclick = async () => {
      if(!confirm('Reset password to a new six-digit code?')) return;
      try{
        const r = await fetch('/api/admin/users/'+u.id+'/reset-password', {
          method:'POST', headers:{ 'Authorization':'Bearer '+state.token }
        });
        const d = await r.json();
        if(!r.ok) throw new Error(d.error || 'Reset failed');
        toast('New password: '+d.password);
      }catch(e){ toast(e.message,false); }
    };

    tr.querySelector('#del'+u.id).onclick = async () => {
      if(!confirm('Delete this user? This cannot be undone.')) return;
      try{
        const r = await fetch('/api/admin/users/'+u.id, {
          method:'DELETE', headers:{ 'Authorization':'Bearer '+state.token }
        });
        const d = await r.json();
        if(!r.ok) throw new Error(d.error || 'Delete failed');
        toast('User deleted');
        fetchUsers();
      }catch(e){ toast(e.message,false); }
    };
  }
}

function loginSubmit(form){
  return async (e)=>{
    e.preventDefault();
    const email = form.querySelector('#email').value.trim();
    const password = form.querySelector('#password').value;
    try{
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Login failed');
      state.token = data.token;
      state.user = data.user;
      render();
      if (state.user.role === 'admin') fetchUsers();
    }catch(err){
      toast(err.message, false);
    }
  };
}

async function fetchUsers() {
  try{
    const r = await fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer ' + state.token } });
    if(!r.ok) throw new Error('Failed to fetch users');
    state.users = await r.json();
    render();
  }catch(e){ toast(e.message, false); }
}

render();
