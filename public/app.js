
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

const fmtUSD = (cents)=> new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format((cents||0)/100);
const fmtPct = (n)=> (n>0?'+':'') + n.toFixed(2) + '%';

// Admin/User SPA with RBAC
const state = { token: null, user: null, users: [], last_updated: null };

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
    // Non-admin view: three stat tiles + last updated + refresh
    const wrap = document.createElement('div');
    const stats = document.createElement('div');
    stats.className = 'stats';
    stats.innerHTML = `
      <div class="stat">
        <div class="label">Current Balance</div>
        <div id="val-balance" class="value balance">$0.00</div>
      </div>
      <div class="stat">
        <div class="label">Deposits</div>
        <div id="val-deposits" class="value medium">$0.00</div>
      </div>
      <div class="stat">
        <div class="label">Performance</div>
        <div id="val-perf" class="value performance">—</div>
        <div class="sub" id="perf-sub"></div>
      </div>
    `;
    wrap.appendChild(stats);

    const meta = document.createElement('div');
    meta.innerHTML = `
      <div class="separator"></div>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap">
        <div class="small" id="lu"></div>
        <button id="refresh">Refresh</button>
      </div>`;
    wrap.appendChild(meta);
    wrap.style.marginTop = '16px';
    app.appendChild(wrap);

    const elBal = stats.querySelector('#val-balance');
    const elDep = stats.querySelector('#val-deposits');
    const elPerf = stats.querySelector('#val-perf');
    const elPerfSub = stats.querySelector('#perf-sub');
    const elLU = meta.querySelector('#lu');

    function populate(d){
      const balC = d.balance_cents||0;
      const depC = d.deposit_cents||0;
      elBal.textContent = fmtUSD(balC);
      elDep.textContent = fmtUSD(depC);
      if (depC > 0){
        const pct = ((balC - depC) / depC) * 100;
        elPerf.textContent = fmtPct(pct);
        elPerf.classList.remove('value--good','value--bad');
        elPerf.classList.add(pct >= 0 ? 'value--good' : 'value--bad','performance');
        elPerfSub.textContent = (pct>=0?'+':'') + fmtUSD(balC - depC) + ' overall';
      } else {
        elPerf.textContent = '—';
        elPerf.classList.remove('value--good','value--bad');
        elPerfSub.textContent = 'Add a deposit to see performance';
      }
      elLU.textContent = d.last_updated ? ('Last Updated: ' + d.last_updated) : '';
    }

    function loadMe(){
      fetch('/api/me', { headers:{ 'Authorization':'Bearer '+state.token }})
        .then(r=>r.json()).then(populate).catch(()=>{});
    }

    meta.querySelector('#refresh').onclick = loadMe;
    loadMe();
    return;
  }

  // ----- Admin-only UI below -----

  // Last Updated control
  const lu = document.createElement('div');
  lu.style.marginTop='16px';
  lu.innerHTML = `
    <div class="row" style="gap:16px; flex-wrap:wrap">
      <div>
        <label>Last Updated (YYYY-MM-DD)</label>
        <input id="lastUpdated" placeholder="2025-08-12" />
      </div>
      <div><button id="saveLU">Save date</button></div>
    </div>
    <div class="small" id="curLU" style="margin-top:6px"></div>
  `;
  app.appendChild(lu);

  fetch('/api/admin/last-updated', { headers:{ 'Authorization':'Bearer '+state.token }})
    .then(r=>r.json()).then(d=>{
      lu.querySelector('#curLU').textContent = d.last_updated ? ('Current: '+d.last_updated) : 'Current: (not set)';
    });

  lu.querySelector('#saveLU').onclick = async ()=>{
    const val = lu.querySelector('#lastUpdated').value.trim();
    if(!val) return toast('Enter a date (YYYY-MM-DD)', false);
    try{
      const r = await fetch('/api/admin/last-updated', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
        body: JSON.stringify({ last_updated: val })
      });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error || 'Save failed');
      toast('Last Updated saved');
      lu.querySelector('#curLU').textContent = 'Current: ' + d.last_updated;
    }catch(e){ toast(e.message,false); }
  };

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
      <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Deposits</th><th>Balance</th><th>Update</th><th>Actions</th></tr></thead>
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
      <td>$${((u.deposit_cents||0) / 100).toFixed(2)}</td>
      <td>$${(u.balance_cents / 100).toFixed(2)}</td>
      <td>
        <div class="row" style="flex-wrap:wrap; gap:8px">
          <input style="max-width:140px" placeholder="New deposit (USD)" id="d${u.id}" />
          <input style="max-width:140px" placeholder="New balance (USD)" id="b${u.id}" />
          <button id="s${u.id}">Save</button>
        </div>
      </td>
      <td class="row" style="gap:8px">
        <button id="reset${u.id}">Reset PW</button>
        <button id="del${u.id}" style="background:#b3261e">Delete</button>
      </td>`;
    tbody.appendChild(tr);

    tr.querySelector('#s' + u.id).onclick = async () => {
      const depVal = tr.querySelector('#d' + u.id).value.trim();
      const balVal = tr.querySelector('#b' + u.id).value.trim();
      const dep = depVal? Number(depVal.replace(/[^0-9.\-]/g,'')) : null;
      const bal = balVal? Number(balVal.replace(/[^0-9.\-]/g,'')) : null;
      if (depVal && !Number.isFinite(dep)) return toast('Deposit must be a number', false);
      if (balVal && !Number.isFinite(bal)) return toast('Balance must be a number', false);
      try{
        // PATCH balance
        if (balVal){
          const r1 = await fetch('/api/admin/users/' + u.id + '/balance', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token },
            body: JSON.stringify({ balance_cents: Math.round(bal * 100) })
          });
          if(!r1.ok) throw new Error('Balance update failed');
        }
        // PATCH deposit (assumes endpoint exists in your current server)
        if (depVal){
          const r2 = await fetch('/api/admin/users/' + u.id + '/deposit', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token },
            body: JSON.stringify({ deposit_cents: Math.round(dep * 100) })
          });
          if(!r2.ok) throw new Error('Deposit update failed');
        }
        toast('Saved');
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
        if(!r.ok) throw new Error('Delete failed');
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
