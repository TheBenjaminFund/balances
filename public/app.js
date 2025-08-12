
const baseUrl = window.location.origin;

// Toast
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

// Public hero: share price + last updated
(async function hero(){
  try{
    const r = await fetch('/api/public-stats');
    if(r.ok){
      const d = await r.json();
      if (typeof d.share_price === 'number') document.getElementById('heroPrice').textContent = '$'+Number(d.share_price).toFixed(2);
      if (d.last_updated) document.getElementById('heroLU').textContent = 'Last Updated: ' + d.last_updated;
    }
  }catch{}
})();

// State
const state = { token:null, user:null, users:[], last_updated:null, share_price:null };

const app = document.getElementById('app');

function render(){
  app.innerHTML = '';
  if(!state.token){
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

  const hdr = document.createElement('div');
  hdr.className = 'row';
  hdr.innerHTML = `
    <div class="badge">Logged in as ${state.user.email} (${state.user.role})</div>
    <div style="flex:1"></div>
    <button id="logout">Log out</button>`;
  hdr.querySelector('#logout').onclick = ()=>{ state.token=null; state.user=null; state.users=[]; render(); };
  app.appendChild(hdr);

  if(state.user.role !== 'admin'){
    // Non-admin: 3 stat tiles + last updated
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="stats">
        <div class="stat">
          <div class="label">Balance</div>
          <div id="uBal" class="value big">$0.00</div>
        </div>
        <div class="stat">
          <div class="label">Deposits</div>
          <div id="uDep" class="value">$0.00</div>
        </div>
        <div class="stat">
          <div class="label">Performance</div>
          <div id="uPerf" class="value">—</div>
          <div class="sub">Since initial deposit</div>
        </div>
      </div>
      <div class="small" id="uLU" style="margin-top:10px"></div>
    `;
    app.appendChild(wrap);
    const fmt = (c)=> '$'+(c/100).toFixed(2);
    const set = (d)=>{
      document.getElementById('uBal').textContent = fmt(d.balance_cents||0);
      document.getElementById('uDep').textContent = fmt(d.deposit_cents||0);
      const dep = d.deposit_cents||0;
      let perfNode = document.getElementById('uPerf');
      if(dep>0){
        const pct = ((d.balance_cents - dep) / dep) * 100;
        const s = (pct>=0?'+':'') + pct.toFixed(2) + '%';
        perfNode.textContent = s;
        perfNode.style.color = pct>=0 ? '#04a156' : '#ff6b6b';
      }else{
        perfNode.textContent = '—';
        perfNode.style.color = '#ffffff';
      }
      document.getElementById('uLU').textContent = d.last_updated ? ('Last Updated: '+d.last_updated) : '';
    };
    fetch('/api/me', { headers:{ 'Authorization':'Bearer '+state.token }})
      .then(r=>r.json()).then(set).catch(()=>{});
    return;
  }

  // ----- Admin only -----
  // Last Updated + Share Price controls
  const controls = document.createElement('div');
  controls.style.marginTop='16px';
  controls.innerHTML = `
    <div class="row" style="gap:16px; flex-wrap:wrap">
      <div>
        <label>Last Updated (YYYY-MM-DD)</label>
        <input id="lastUpdated" placeholder="2025-08-12" />
      </div>
      <div><button id="saveLU">Save date</button></div>
      <div>
        <label>Share Price (USD)</label>
        <input id="sharePrice" placeholder="100.00" />
      </div>
      <div><button id="saveSP">Save price</button></div>
    </div>
    <div class="small" id="curMeta" style="margin-top:6px"></div>
  `;
  app.appendChild(controls);

  const refreshMeta = async()=>{
    const [lu, sp] = await Promise.all([
      fetch('/api/admin/last-updated', { headers:{ 'Authorization':'Bearer '+state.token }}).then(r=>r.json()).catch(()=>({})),
      fetch('/api/admin/share-price', { headers:{ 'Authorization':'Bearer '+state.token }}).then(r=>r.json()).catch(()=>({}))
    ]);
    const txt = `Current Last Updated: ${lu.last_updated||'(not set)'} • Share Price: ${sp.share_price!=null?('$'+Number(sp.share_price).toFixed(2)):'(not set)'}`;
    controls.querySelector('#curMeta').textContent = txt;
  };
  refreshMeta();

  controls.querySelector('#saveLU').onclick = async ()=>{
    const val = controls.querySelector('#lastUpdated').value.trim();
    if(!val) return toast('Enter a date (YYYY-MM-DD)', false);
    const r = await fetch('/api/admin/last-updated', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
      body: JSON.stringify({ last_updated: val })
    });
    const d = await r.json();
    if(!r.ok) return toast(d.error||'Save failed', false);
    toast('Last Updated saved'); refreshMeta();
  };
  controls.querySelector('#saveSP').onclick = async ()=>{
    const val = parseFloat(controls.querySelector('#sharePrice').value.trim());
    if(Number.isNaN(val)) return toast('Enter a number for share price', false);
    const r = await fetch('/api/admin/share-price', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
      body: JSON.stringify({ share_price: val })
    });
    const d = await r.json();
    if(!r.ok) return toast(d.error||'Save failed', false);
    toast('Share price saved'); refreshMeta();
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
    const r = await fetch('/api/admin/users', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if(!r.ok) return toast(d.error||'Create failed', false);
    toast('User created. Password: '+d.password); fetchUsers();
  };

  // Users table
  const tableWrap = document.createElement('div');
  tableWrap.style.marginTop='16px';
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Balance</th><th>Deposits</th><th>Update</th><th>Actions</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table>`;
  app.appendChild(tableWrap);

  const tbody = tableWrap.querySelector('#tbody');
  const rowUI = (u)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.role}</td>
      <td>$${(u.balance_cents/100).toFixed(2)}</td>
      <td>$${(u.deposit_cents/100).toFixed(2)}</td>
      <td>
        <div class="row">
          <input style="max-width:150px" placeholder="New balance (USD)" id="b${u.id}" />
          <button id="sb${u.id}">Save</button>
          <input style="max-width:150px" placeholder="New deposit (USD)" id="d${u.id}" />
          <button id="sd${u.id}">Save</button>
        </div>
      </td>
      <td class="row" style="gap:8px">
        <button id="reset${u.id}">Reset PW</button>
        <button id="del${u.id}" style="background:#b3261e">Delete</button>
      </td>`;
    tbody.appendChild(tr);

    tr.querySelector('#sb'+u.id).onclick = async ()=>{
      const val = tr.querySelector('#b'+u.id).value.trim();
      const usd = Number(val.replace(/[^0-9.\-]/g,''));
      if(!Number.isFinite(usd)) return toast('Enter numeric USD', false);
      const r = await fetch('/api/admin/users/'+u.id+'/balance', {
        method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
        body: JSON.stringify({ balance_cents: Math.round(usd*100) })
      });
      const d = await r.json();
      if(!r.ok) return toast(d.error||'Update failed', false);
      toast('Balance updated'); fetchUsers();
    };
    tr.querySelector('#sd'+u.id).onclick = async ()=>{
      const val = tr.querySelector('#d'+u.id).value.trim();
      const usd = Number(val.replace(/[^0-9.\-]/g,''));
      if(!Number.isFinite(usd)) return toast('Enter numeric USD', false);
      const r = await fetch('/api/admin/users/'+u.id+'/deposit', {
        method:'PATCH', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token },
        body: JSON.stringify({ deposit_cents: Math.round(usd*100) })
      });
      const d = await r.json();
      if(!r.ok) return toast(d.error||'Update failed', false);
      toast('Deposit updated'); fetchUsers();
    };
    tr.querySelector('#reset'+u.id).onclick = async ()=>{
      if(!confirm('Reset password to a new six-digit code?')) return;
      const r = await fetch('/api/admin/users/'+u.id+'/reset-password', {
        method:'POST', headers:{ 'Authorization':'Bearer '+state.token }
      });
      const d = await r.json();
      if(!r.ok) return toast(d.error||'Reset failed', false);
      toast('New password: '+d.password);
    };
    tr.querySelector('#del'+u.id).onclick = async ()=>{
      if(!confirm('Delete this user?')) return;
      const r = await fetch('/api/admin/users/'+u.id, {
        method:'DELETE', headers:{ 'Authorization':'Bearer '+state.token }
      });
      const d = await r.json();
      if(!r.ok) return toast(d.error||'Delete failed', false);
      toast('User deleted'); fetchUsers();
    };
  };

  async function fetchUsers(){
    const r = await fetch('/api/admin/users', { headers:{ 'Authorization':'Bearer '+state.token }});
    const list = await r.json();
    tbody.innerHTML = '';
    list.forEach(rowUI);
  }
  fetchUsers();
}

function loginSubmit(form){
  return async (e)=>{
    e.preventDefault();
    const email = form.querySelector('#email').value.trim();
    const password = form.querySelector('#password').value;
    const r = await fetch('/api/auth/login', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if(!r.ok) return toast(d.error||'Login failed', false);
    state.token = d.token; state.user = d.user; render();
  };
}

render();
