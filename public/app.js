const app = document.getElementById('app');
const state = { token:null, user:null };

const fmtMoney = (cents) => {
  if (cents === null || cents === undefined) return '—';
  const val = Number(cents) / 100;
  return new Intl.NumberFormat(undefined, { style:'currency', currency:'USD', maximumFractionDigits:2 }).format(val);
};

function toast(msg, ok=true){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>{ el.remove(); }, ok?1800:2400);
}

function renderLogin(){
  app.innerHTML = '';
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `
    <h1>Sign in</h1>
    <div class="row">
      <input id="email" type="email" placeholder="Email">
      <input id="password" type="password" placeholder="Password">
      <button id="login">Login</button>
    </div>
  `;
  app.appendChild(card);
  card.querySelector('#login').onclick = async ()=>{
    const email = card.querySelector('#email').value.trim();
    const password = card.querySelector('#password').value.trim();
    if(!email || !password) return toast('Enter email/password', false);
    try{
      const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password })});
      if(!r.ok) throw new Error('bad');
      const d = await r.json();
      state.token = d.token; state.user = d.user;
      state.user.balance_cents = d.balance_cents; state.user.deposit_cents = d.deposit_cents;
      state.user.year_2024_deposits_cents = d.year_2024_deposits_cents ?? 0;
      state.user.year_2024_ending_balance_cents = d.year_2024_ending_balance_cents ?? 0;
      renderHome();
    }catch(e){ toast('Login failed', false); }
  };
}

function renderUserYearSection(container, d){
  const dep = d.year_2024_deposits_cents ?? null;
  const end = d.year_2024_ending_balance_cents ?? null;
  let pl = null, pct = null;
  if (dep !== null && end !== null){
    pl = end - dep;
    pct = dep > 0 ? (pl/dep)*100 : null;
  }
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>2024 Results</h2>
    <div class="stats four">
      <div class="stat"><div class="label">2024 Deposits</div><div class="value">${fmtMoney(dep)}</div></div>
      <div class="stat"><div class="label">2024 Ending Balance</div><div class="value">${fmtMoney(end)}</div></div>
      <div class="stat perf-big"><div class="label">2024 Performance ($)</div><div class="value">${pl===null?'—':fmtMoney(pl)}</div></div>
      <div class="stat perf-big"><div class="label">2024 Performance (%)</div><div class="value">${pct===null?'—':((pl>=0?'+':'')+pct.toFixed(2)+'%')}</div></div>
    </div>
    <div class="subtle">These are <strong>2024-only</strong> figures and separate from your overall totals.</div>
  `;
  container.appendChild(card);
}

function renderPasswordChange(container){
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Change Password</h2>
    <div class="row">
      <input id="curPwd" type="password" placeholder="Current password"/>
      <input id="newPwd" type="password" placeholder="New password"/>
      <input id="newPwd2" type="password" placeholder="Confirm new password"/>
      <button id="savePwd" class="btn">Update</button>
    </div>
  `;
  container.appendChild(card);
  card.querySelector('#savePwd').onclick = async () => {
    const a = card.querySelector('#curPwd').value.trim();
    const b = card.querySelector('#newPwd').value.trim();
    const c = card.querySelector('#newPwd2').value.trim();
    if(!a || !b || !c) return toast('Fill all fields', false);
    if(b !== c) return toast('New passwords do not match', false);
    try{
      const r = await fetch('/api/me/password', {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
        body: JSON.stringify({ current_password:a, new_password:b })
      });
      if(!r.ok) throw new Error('bad');
      toast('Password updated');
      card.querySelectorAll('input').forEach(i=>i.value='');
    }catch(e){ toast('Update failed', false); }
  };
}

function renderAdmin(container){
  const wrap = document.createElement('div'); wrap.className = 'card';
  wrap.innerHTML = `<h2>Admin</h2><div id="adminRoot"></div>`;
  container.appendChild(wrap);
  const root = wrap.querySelector('#adminRoot');

  // Create User
  const create = document.createElement('div'); create.className='card';
  create.innerHTML = `
    <h3>Create User</h3>
    <div class="row" style="flex-wrap:wrap; gap:8px">
      <input id="newEmail" type="email" placeholder="Email">
      <input id="newPass" type="text" placeholder="(Optional) Set password">
      <button id="createUser">Add User</button>
    </div>
    <div class="subtle">If no password is provided, a temporary password will be generated.</div>
  `;
  root.appendChild(create);
  create.querySelector('#createUser').onclick = async ()=>{
    const email = create.querySelector('#newEmail').value.trim();
    const password = create.querySelector('#newPass').value.trim();
    if(!email) return toast('Email required', false);
    try{
      const r = await fetch('/api/admin/users', {
        method:'POST',
        headers:{ 'Content-Type':'application/json','Authorization':'Bearer '+state.token },
        body: JSON.stringify({ email, password: password || undefined })
      });
      if(!r.ok) throw new Error('bad');
      const j = await r.json();
      toast('User created'+(j.temp_password?(' — temp password: '+j.temp_password):''));
      create.querySelector('#newEmail').value=''; create.querySelector('#newPass').value='';
      fetchUsers();
    }catch(e){ toast('Create failed', false); }
  };

  // Settings
  const settings = document.createElement('div'); settings.className='card';
  settings.innerHTML = `
    <h3>Settings</h3>
    <div class="row">
      <input id="lu" placeholder="Last Updated (YYYY-MM-DD)"/>
      <button id="saveSettings">Save Settings</button>
    </div>
  `;
  root.appendChild(settings);

  // Users table
  const users = document.createElement('div'); users.className='card';
  users.innerHTML = `<h3>Users</h3><div id="usersWrap"></div>`;
  root.appendChild(users);

  async function fetchUsers(){
    const r = await fetch('/api/admin/users', { headers:{ 'Authorization':'Bearer '+state.token } });
    const list = await r.json();
    const table = document.createElement('table'); table.className='table mono';
    table.innerHTML = `
      <thead><tr>
        <th>ID</th><th>Email</th><th>Role</th>
        <th>Balance</th><th>Deposit</th>
        <th>2024 Deposits</th><th>2024 Ending</th>
        <th>Update</th><th>Actions</th>
      </tr></thead>
      <tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    list.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.id}</td>
        <td>${u.email}</td>
        <td>${u.role}</td>
        <td>${fmtMoney(u.balance_cents)}</td>
        <td>${fmtMoney(u.deposit_cents)}</td>
        <td>${fmtMoney(u.year_2024_deposits_cents)}</td>
        <td>${fmtMoney(u.year_2024_ending_balance_cents)}</td>
        <td>
          <div class="row" style="gap:6px; flex-wrap:wrap">
            <input style="max-width:120px" placeholder="New bal (USD)" id="b${u.id}" />
            <input style="max-width:120px" placeholder="New dep (USD)" id="d${u.id}" />
            <button id="s${u.id}">Save</button>
          </div>
          <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:6px">
            <input style="max-width:140px" placeholder="New 2024 dep (USD)" id="ydep${u.id}" />
            <input style="max-width:140px" placeholder="New 2024 end (USD)" id="yend${u.id}" />
          </div>
        </td>
        <td>
          <button id="rp${u.id}">Reset Password</button>
          <button id="del${u.id}">Delete</button>
        </td>`;

      // Save totals (+ optional 2024)
      tr.querySelector('#s'+u.id).onclick = async ()=>{
        const bv = tr.querySelector('#b'+u.id).value.trim();
        const dv = tr.querySelector('#d'+u.id).value.trim();
        const ydepv = tr.querySelector('#ydep'+u.id).value.trim();
        const yendv = tr.querySelector('#yend'+u.id).value.trim();
        try{
          if(bv) await fetch('/api/admin/users/'+u.id+'/balance', { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ balance_cents: Math.round(Number(bv.replace(/[^0-9.\-]/g,''))*100) }) });
          if(dv) await fetch('/api/admin/users/'+u.id+'/deposit', { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ deposit_cents: Math.round(Number(dv.replace(/[^0-9.\-]/g,''))*100) }) });
          if(ydepv || yendv) await fetch('/api/admin/users/'+u.id+'/year/2024', { method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ deposits_cents: ydepv? Math.round(Number(ydepv.replace(/[^0-9.\-]/g,''))*100): undefined, ending_balance_cents: yendv? Math.round(Number(yendv.replace(/[^0-9.\-]/g,''))*100): undefined }) });
          toast('Updated'); fetchUsers();
        }catch(e){ toast('Save failed', false); }
      };

      // Reset password
      tr.querySelector('#rp'+u.id).onclick = async ()=>{
        try{
          const r = await fetch('/api/admin/users/'+u.id+'/reset-password', { method:'POST', headers:{ 'Authorization':'Bearer '+state.token } });
          const j = await r.json(); toast('Temp password: '+j.password);
        }catch(e){ toast('Reset failed', false); }
      };

      // Delete
      tr.querySelector('#del'+u.id).onclick = async ()=>{
        if(!confirm('Delete user '+u.email+'?')) return;
        try{
          await fetch('/api/admin/users/'+u.id, { method:'DELETE', headers:{ 'Authorization':'Bearer '+state.token } });
          toast('Deleted'); fetchUsers();
        }catch(e){ toast('Delete failed', false); }
      };

      tbody.appendChild(tr);
    });
    users.querySelector('#usersWrap').innerHTML = '';
    users.querySelector('#usersWrap').appendChild(table);
  }

  // load settings (only last-updated) and users
  (async ()=>{
    try{
      const s = await (await fetch('/api/admin/last-updated', { headers:{ 'Authorization':'Bearer '+state.token } })).json();
      settings.querySelector('#lu').value = s.last_updated || '';
    }catch(e){}
    fetchUsers();
  })();

  settings.querySelector('#saveSettings').onclick = async ()=>{
    const lu = settings.querySelector('#lu').value.trim();
    try{
      if(lu) await fetch('/api/admin/last-updated', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ last_updated: lu }) });
      toast('Settings saved');
    }catch(e){ toast('Save failed', false); }
  };
}

function renderHome(){
  app.innerHTML = '';

  const header = document.createElement('div'); header.className='card';
  header.innerHTML = `<div class="row" style="justify-content:space-between">
    <h1>Benjamin Fund</h1>
    <div class="row">
      <div class="subtle">${state.user.email} (${state.user.role})</div>
      <button id="logout">Logout</button>
    </div>
  </div>`;
  app.appendChild(header);
  header.querySelector('#logout').onclick = ()=>{ state.token=null; state.user=null; renderLogin(); };

  // Load 'me' fresh
  fetch('/api/me', { headers:{ 'Authorization':'Bearer '+state.token } })
    .then(r=>r.json()).then(d=>{
      state.user = d;
      const card = document.createElement('div'); card.className='card';
      const bal = d.balance_cents ?? 0;
      const dep = d.deposit_cents ?? 0;
      const pl = (bal - dep);
      const pct = dep > 0 ? (pl/dep)*100 : null;
      card.innerHTML = `
        <div class="stats">
          <div class="stat"><div class="label">Balance</div><div class="value" id="bal">${fmtMoney(bal)}</div></div>
          <div class="stat"><div class="label">Deposits</div><div class="value" id="dep">${fmtMoney(dep)}</div></div>
          <div class="stat perf-big"><div class="label">Performance</div><div class="value">${pl>=0?'+':''}${pct===null?'—':pct.toFixed(2)+'%'} (${fmtMoney(pl)})</div></div>
        </div>
        <div class=\"subtle\" id=\"currentYearNote\"></div>`;
      app.appendChild(card);
      const yr=new Date().getFullYear(); document.getElementById('currentYearNote').textContent = `Current totals — ${yr} YTD`;

      renderUserYearSection(app, d);
      renderPasswordChange(app);

      if (d.role === 'admin'){
        renderAdmin(app);
      }
    }).catch(()=>toast('Failed to load profile', false));
}

renderLogin();
