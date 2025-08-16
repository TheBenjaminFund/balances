
// --- Admin: Yearly (2024) & Balances UI Enhancements ---
(function(){
  const mount = document.getElementById('app');
  if (!mount) return;

  const thisYear = new Date().getFullYear();
  const lastYear = thisYear - 1;

  const wait = setInterval(()=>{
    if (window.initAdminUI){
      clearInterval(wait);
      const origInit = window.initAdminUI;
      window.initAdminUI = function(state){
        origInit && origInit(state);

        const panel = document.createElement('div');
        panel.className = 'card';
        panel.style.marginTop = '16px';
        panel.innerHTML = `
          <h2 style="margin:0 0 8px">Investor Balances & Deposits</h2>
          <div class="small" style="margin-bottom:12px">Edit current balances and deposits, and record prior-year (${lastYear}) totals.</div>
          <div id="adm-users-wrap" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px"></div>
          <div class="small" style="margin-top:12px">These ${lastYear} values power the investor-facing “${lastYear} Summary”.</div>
        `;
        mount.appendChild(panel);

        fetch('/api/admin/users', { headers:{ 'Authorization':'Bearer '+state.token } })
          .then(r=>r.json()).then(users=>{
            const wrap = panel.querySelector('#adm-users-wrap');
            users.forEach(u=>{
              const card = document.createElement('div');
              card.className = 'mini-card';
              card.style.border = '1px solid #e5e7eb';
              card.style.borderRadius = '12px';
              card.style.padding = '12px';
              card.innerHTML = \`
                <div style="font-weight:600; margin-bottom:8px">\${u.email}</div>
                <div style="display:flex; gap:8px; flex-wrap:wrap">
                  <div><label>Current Balance (¢)</label><input type="number" step="1" min="0" id="bal-\${u.id}" value="\${u.balance_cents}" /></div>
                  <div><label>Total Deposits (¢)</label><input type="number" step="1" min="0" id="dep-\${u.id}" value="\${u.deposit_cents}" /></div>
                  <button id="save-\${u.id}">Save</button>
                </div>
                <hr style="margin:12px 0">
                <div style="display:flex; gap:8px; flex-wrap:wrap">
                  <div><label>\${lastYear} Deposits (¢)</label><input type="number" step="1" min="0" id="ydep-\${u.id}" value="0" /></div>
                  <div><label>\${lastYear} Ending Balance (¢)</label><input type="number" step="1" min="0" id="yend-\${u.id}" value="0" /></div>
                  <button id="ysave-\${u.id}">Save \${lastYear}</button>
                </div>
              \`;
              wrap.appendChild(card);

              fetch('/api/admin/users/'+u.id+'/yearly?year='+lastYear, { headers:{ 'Authorization':'Bearer '+state.token } })
                .then(r=>r.json()).then(y=>{
                  card.querySelector('#ydep-'+u.id).value = y.deposit_cents||0;
                  card.querySelector('#yend-'+u.id).value = y.ending_cents||0;
                }).catch(()=>{});

              card.querySelector('#save-'+u.id).onclick = async ()=>{
                const bal = Number(card.querySelector('#bal-'+u.id).value||0);
                const dep = Number(card.querySelector('#dep-'+u.id).value||0);
                await fetch('/api/admin/users/'+u.id+'/balance', { method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.token}, body: JSON.stringify({ balance_cents: bal }) });
                await fetch('/api/admin/users/'+u.id+'/deposit', { method:'PATCH', headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.token}, body: JSON.stringify({ deposit_cents: dep }) });
                toast('Saved balances for '+u.email);
              };

              card.querySelector('#ysave-'+u.id).onclick = async ()=>{
                const ydep = Number(card.querySelector('#ydep-'+u.id).value||0);
                const yend = Number(card.querySelector('#yend-'+u.id).value||0);
                await fetch('/api/admin/users/'+u.id+'/yearly', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+state.token}, body: JSON.stringify({ year: lastYear, deposit_cents: ydep, ending_cents: yend }) });
                toast('Saved '+lastYear+' summary for '+u.email);
              };
            });
          });
      };
    }
  }, 200);
})();

function formatMoneyDollars(d){ return '$'+Number(d).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatMoneyCents(c){ return '$'+(c/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

// Fetch public stats for hero
(async function loadHero(){
  try{
    const r = await fetch('/api/public-stats');
    if(r.ok){
      const d = await r.json();
      if (typeof d.share_price === 'number') {
        document.getElementById('heroPrice').textContent = d.share_price.toFixed(2);
      }
      if (d.last_updated) {
        document.getElementById('heroLU').textContent = 'Last Updated: ' + d.last_updated;
      }
    }
  }catch{}
})();

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

const state = { token:null, user:null, users:[] };
const app = document.getElementById('app');

function render(){
  app.innerHTML = '';

  if(!state.token){
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="grid">
        <div><label>Email</label><input id="email" placeholder="you@example.com" /></div>
        <div><label>Password</label><input id="password" type="password" placeholder="••••••••" /></div>
      </div>
      <div style="margin-top:12px"><button type="submit">Login</button></div>`;
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
    const wrap = document.createElement('div');
    wrap.style.marginTop='16px';
    wrap.innerHTML = `
      <div class="stats">
        <div class="stat">
          <div class="label">Balance</div>
          <div id="bal" class="value">$0.00</div>
          <div id="balLU" class="sub"></div>
        </div>
        <div class="stat">
          <div class="label">Deposits</div>
          <div id="dep" class="value">$0.00</div>
          <div class="sub">Total contributed</div>
        </div>
        <div class="stat">
          <div class="label">Performance</div>
          <div class="value">
            <span id="perfPct" class="pill">—</span>
            <span id="perfDol" class="pill" style="margin-left:8px">—</span>
          </div>
          <div class="sub">vs deposits</div>
        </div>
      </div>`;
    app.appendChild(wrap);
    fetch('/api/me', { headers:{ 'Authorization':'Bearer '+state.token } })
      .then(r=>r.json()).then(d=>{
        const bal = d.balance_cents||0;
        const dep = d.deposit_cents||0;
        const pl = bal - dep;
        const pct = dep > 0 ? (pl/dep)*100 : null;
        wrap.querySelector('#bal').textContent = '$'+(bal/100).toFixed(2);
        wrap.querySelector('#dep').textContent = '$'+(dep/100).toFixed(2);
        if (d.last_updated) wrap.querySelector('#balLU').textContent = 'Last Updated: ' + d.last_updated;
        const pctEl = wrap.querySelector('#perfPct');
        const dolEl = wrap.querySelector('#perfDol');
        if (pct === null){
          pctEl.textContent = '—';
          dolEl.textContent = '—';
          pctEl.className = 'pill';
          dolEl.className = 'pill';
        } else {
          const isUp = pl >= 0;
          pctEl.textContent = (isUp?'+':'') + pct.toFixed(2) + '%';
          dolEl.textContent = (isUp?'+':'') + formatMoneyCents(Math.abs(pl));
          pctEl.className = 'pill ' + (isUp?'green':'red');
          dolEl.className = 'pill ' + (isUp?'green':'red');
        }
      });
    return;
  }

  // --- Admin UI ---

  // Settings: share price + last updated
  const settings = document.createElement('div');
  settings.style.marginTop='16px';
  settings.innerHTML = `
    <h2>Settings</h2>
    <div class="row" style="gap:16px; flex-wrap:wrap">
      <div style="flex:1; min-width:320px"><label>Pre‑Login Message (empty to hide)</label><textarea id="preMsg" placeholder="Optional message shown above the login form" rows="3" style="width:100%"></textarea></div>
      <div><label>Share Price (USD)</label><input id="sp" placeholder="100.00" /></div>
      <div><label>Last Updated (YYYY-MM-DD)</label><input id="lu" placeholder="2025-08-12" /></div>
      <div style="align-self:end"><button id="saveSettings">Save</button></div>
    </div>
    <div class="small" id="curSettings" style="margin-top:6px"></div>`;
  app.appendChild(settings);

  Promise.all([
    fetch('/api/admin/share-price', { headers:{ 'Authorization':'Bearer '+state.token } }).then(r=>r.json()),
    fetch('/api/admin/last-updated', { headers:{ 'Authorization':'Bearer '+state.token } }).then(r=>r.json()),
    fetch('/api/admin/prelogin-message', { headers:{ 'Authorization':'Bearer '+state.token } }).then(r=>r.json())
  ]).then(([sp, lu, pm]) => {
    const cur = [];
    if (sp.share_price !== null && sp.share_price !== undefined) cur.push('Share Price: '+formatMoneyDollars(sp.share_price));
    if (lu.last_updated) cur.push('Last Updated: '+lu.last_updated);
    if (pm && typeof pm.message === 'string') settings.querySelector('#preMsg').value = pm.message;
    settings.querySelector('#curSettings').textContent = cur.length ? ('Current – '+cur.join(' | ')) : 'Current: (not set)';
  });

  settings.querySelector('#saveSettings').onclick = async ()=>{
    const preMsg = settings.querySelector('#preMsg').value;
    const sp = settings.querySelector('#sp').value.trim();
    const lu = settings.querySelector('#lu').value.trim();
    try{
      if(sp) await fetch('/api/admin/share-price', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ share_price: Number(sp) }) });
      if(lu) await fetch('/api/admin/last-updated', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ last_updated: lu }) });
      await fetch('/api/admin/prelogin-message', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ message: preMsg }) });
      toast('Settings saved');
    }catch(e){ toast('Save failed', false); }
  };

  // Create user
  const add = document.createElement('div');
  add.style.marginTop='16px';
  add.innerHTML = `
    <h2>Users</h2>
    <div class="row" style="gap:16px; flex-wrap:wrap">
      <div style="flex:1; min-width:320px"><label>Pre‑Login Message (empty to hide)</label><textarea id="preMsg" placeholder="Optional message shown above the login form" rows="3" style="width:100%"></textarea></div>
      <div style="flex:1; min-width:220px"><label>New user email</label><input id="newEmail" placeholder="user@example.com" /></div>
      <div style="flex:1; min-width:220px"><label>Temp password (6 digits ok)</label><input id="newPass" placeholder="e.g. 482913" /></div>
      <div style="align-self:end"><button id="create">Create user</button></div>
    </div>`;
  app.appendChild(add);

  add.querySelector('#create').onclick = async ()=>{
    const email = add.querySelector('#newEmail').value.trim().toLowerCase();
    const password = add.querySelector('#newPass').value.trim();
    if(!email || !password) return toast('Email and password required', false);
    try{
      const r = await fetch('/api/admin/users', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+state.token }, body: JSON.stringify({ email, password }) });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error || 'Create failed');
      toast('User created. Password: ' + d.password);
      add.querySelector('#newEmail').value=''; add.querySelector('#newPass').value='';
      fetchUsers();
    }catch(e){ toast(e.message,false); }
  };

  // Users table
  const tableWrap = document.createElement('div');
  tableWrap.style.marginTop = '16px';
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Balance</th><th>Deposit</th><th>Update</th><th>Actions</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table>`;
  app.appendChild(tableWrap);

  function rowEl(u){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.role}</td>
      <td>$${(u.balance_cents/100).toFixed(2)}</td>
      <td>$${(u.deposit_cents/100).toFixed(2)}</td>
      <td>
        <div class="row">
          <input style="max-width:120px" placeholder="New bal (USD)" id="b${u.id}" />
          <input style="max-width:120px" placeholder="New dep (USD)" id="d${u.id}" />
          <button id="s${u.id}">Save</button>
        </div>
      </td>
      <td class="row" style="gap:8px">
        <button id="reset${u.id}">Reset PW</button>
        <button id="del${u.id}" style="background:#b3261e">Delete</button>
      </td>`;

    tr.querySelector('#s'+u.id).onclick = async ()=>{
      const bv = tr.querySelector('#b'+u.id).value.trim();
      const dv = tr.querySelector('#d'+u.id).value.trim();
      try{
        if(bv){ await fetch('/api/admin/users/'+u.id+'/balance', { method:'PATCH', headers:{ 'Content-Type':'application/json','Authorization':'Bearer '+state.token }, body: JSON.stringify({ balance_cents: Math.round(Number(bv.replace(/[^0-9.\-]/g,''))*100) }) }); }
        if(dv){ await fetch('/api/admin/users/'+u.id+'/deposit', { method:'PATCH', headers:{ 'Content-Type':'application/json','Authorization':'Bearer '+state.token }, body: JSON.stringify({ deposit_cents: Math.round(Number(dv.replace(/[^0-9.\-]/g,''))*100) }) }); }
        toast('Updated');
        fetchUsers();
      }catch(e){ toast('Update failed', false); }
    };

    tr.querySelector('#reset'+u.id).onclick = async ()=>{
      if(!confirm('Reset password to a new 6-digit code?')) return;
      const r = await fetch('/api/admin/users/'+u.id+'/reset-password', { method:'POST', headers:{ 'Authorization':'Bearer '+state.token } });
      const d = await r.json();
      if(r.ok) toast('New password: '+d.password); else toast('Reset failed', false);
    };

    tr.querySelector('#del'+u.id).onclick = async ()=>{
      if(!confirm('Delete this user?')) return;
      const r = await fetch('/api/admin/users/'+u.id, { method:'DELETE', headers:{ 'Authorization':'Bearer '+state.token } });
      if(r.ok) {{ toast('User deleted'); fetchUsers(); }} else toast('Delete failed', false);
    };

    return tr;
  }

  async function fetchUsers(){
    const r = await fetch('/api/admin/users', { headers:{ 'Authorization':'Bearer '+state.token } });
    const arr = await r.json();
    const tbody = tableWrap.querySelector('#tbody'); tbody.innerHTML='';
    arr.forEach(u => tbody.appendChild(rowEl(u)));
  }
  fetchUsers();
}

function loginSubmit(form){
  return async (e)=>{
    e.preventDefault();
    const email = form.querySelector('#email').value.trim();
    const password = form.querySelector('#password').value;
    try{
      const r = await fetch('/api/auth/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email, password }) });
      const d = await r.json();
      if(!r.ok) throw new Error(d.error || 'Login failed');
      state.token = d.token; state.user = d.user;
      render();
    }catch(err){ toast(err.message,false); }
  };
}

render();
