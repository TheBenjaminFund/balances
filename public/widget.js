
(function(){
  const fmtUSD = (c)=> new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((c||0)/100);
  const fmtPct = (n)=> (n>0?'+':'') + n.toFixed(2) + '%';

  class BalanceWidget extends HTMLElement{
    constructor(){
      super();
      this.attachShadow({ mode:'open' });
      this.state = { token:null, user:null, balance_cents:0, deposit_cents:0, last_updated:null, baseUrl: this.getAttribute('data-base-url') || '' };
      this.render();
    }
    setState(p){ this.state = {...this.state, ...p}; this.render(); }
    async login(email, password){
      const r = await fetch(this.state.baseUrl + '/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if(r.ok){ this.setState({ token:data.token, user:data.user, balance_cents:data.balance_cents }); this.me(); }
      else alert(data.error || 'Login failed');
    }
    async me(){
      const r = await fetch(this.state.baseUrl + '/api/me', { headers:{ 'Authorization':'Bearer '+this.state.token }});
      if(r.ok){ const d = await r.json(); this.setState({ user:d.user, balance_cents:d.balance_cents, deposit_cents:d.deposit_cents, last_updated:d.last_updated }); }
    }
    render(){
      const bal = this.state.balance_cents||0;
      const dep = this.state.deposit_cents||0;
      const perf = dep>0 ? ((bal-dep)/dep)*100 : null;
      const perfClass = perf==null ? '' : (perf>=0?'value--good':'value--bad');

      this.shadowRoot.innerHTML = `
        <style>
          :root{ --accent:#04a156; --danger:#ef4444; }
          :host{ display:block; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif; }
          .card{ background:#1e1e1e; color:#ffffff; border-radius:16px; box-shadow:0 10px 25px rgba(0,0,0,.35); padding:18px; max-width:520px }
          label{ display:block; font-size:12px; color:#cfcfcf; margin-bottom:6px }
          input{ background:#151515; border:1px solid #2b2b2b; color:#ffffff; border-radius:12px; padding:10px 12px; width:100% }
          button{ border:0; border-radius:12px; padding:10px 14px; cursor:pointer; background:#04a156; color:white; box-shadow:0 6px 16px rgba(4,161,86,.35); font-weight:600 }
          .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap }
          .muted{ color:#cfcfcf; font-size:12px }
          .stats{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:10px }
          @media (max-width:560px){ .stats{ grid-template-columns:1fr; } }
          .stat{ background:#1b1b1b; border:1px solid #2b2b2b; border-radius:12px; padding:14px; }
          .label{ color:#bdbdbd; font-size:11px; letter-spacing:.4px; text-transform:uppercase }
          .value{ font-weight:800; margin-top:4px }
          .value.balance{ font-size:42px; line-height:1.05 }
          .value.medium{ font-size:22px }
          .value.performance{ font-size:28px }
          .value--good{ color: var(--accent) }
          .value--bad{ color: var(--danger) }
          .sub{ color:#9a9a9a; font-size:12px; margin-top:8px }
        </style>
        <div class="card">
          ${this.state.token ? `
            <div class="muted">Logged in as ${this.state.user?.email || ''}</div>
            <div class="stats">
              <div class="stat">
                <div class="label">Current Balance</div>
                <div class="value balance">${fmtUSD(bal)}</div>
              </div>
              <div class="stat">
                <div class="label">Deposits</div>
                <div class="value medium">${fmtUSD(dep)}</div>
              </div>
              <div class="stat">
                <div class="label">Performance</div>
                <div class="value performance ${perfClass}">${perf==null?'—':fmtPct(perf)}</div>
                <div class="sub">${dep>0 ? ((perf>=0?'+':'')+fmtUSD(bal-dep)+' overall') : 'Add a deposit to see performance'}</div>
              </div>
            </div>
            ${this.state.last_updated ? `<div class="muted" style="margin-top:10px">Last Updated: ${this.state.last_updated}</div>` : ''}
            <div style="margin-top:12px" class="row">
              <button id="refresh">Refresh</button>
              <button id="logout" style="background:#333333">Log out</button>
            </div>
          ` : `
            <form id="login">
              <div>
                <label>Email</label>
                <input id="email" placeholder="you@example.com" />
              </div>
              <div style="margin-top:8px">
                <label>Password</label>
                <input id="password" type="password" placeholder="••••••••" />
              </div>
              <div style="margin-top:12px">
                <button type="submit">Log in</button>
              </div>
              <div class="muted" style="margin-top:8px">Use your email and your six-digit investor ID.</div>
            </form>
          `}
        </div>
      `;
      if(this.state.token){
        this.shadowRoot.getElementById('refresh').onclick = () => this.me();
        this.shadowRoot.getElementById('logout').onclick = () => this.setState({ token:null, user:null, balance_cents:0, deposit_cents:0, last_updated:null });
      }else{
        const form = this.shadowRoot.getElementById('login');
        form.onsubmit = (e)=>{
          e.preventDefault();
          const email = this.shadowRoot.getElementById('email').value.trim();
          const password = this.shadowRoot.getElementById('password').value;
          this.login(email, password);
        };
      }
    }
  }
  customElements.define('balance-widget', BalanceWidget);
})();