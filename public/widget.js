
(function(){
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
      if(r.ok){ this.setState({ token:data.token, user:data.user, balance_cents:data.balance_cents, deposit_cents:data.deposit_cents, last_updated:data.last_updated }); }
      else alert(data.error || 'Login failed');
    }
    async me(){
      const r = await fetch(this.state.baseUrl + '/api/me', { headers:{ 'Authorization':'Bearer '+this.state.token }});
      if(r.ok){ const d = await r.json(); this.setState({ user:d.user, balance_cents:d.balance_cents, deposit_cents:d.deposit_cents, last_updated:d.last_updated }); }
    }
    render(){
      const usd = '$' + (this.state.balance_cents/100).toFixed(2);
      const dep = '$' + (this.state.deposit_cents/100).toFixed(2);
      let perf = '—', cls = '';
      if (this.state.deposit_cents > 0){
        const pct = ((this.state.balance_cents - this.state.deposit_cents)/this.state.deposit_cents)*100;
        const sign = pct >= 0 ? '+' : '';
        perf = sign + pct.toFixed(2) + '%';
        cls = pct >= 0 ? 'gain' : 'loss';
      }
      this.shadowRoot.innerHTML = `
        <style>
          :host{ display:block; font-family: inherit; }
          .card{ background:#1e1e1e; color:#ffffff; border-radius:16px; box-shadow:0 10px 25px rgba(0,0,0,.35); padding:16px; max-width:520px }
          label{ display:block; font-size:12px; color:#cfcfcf; margin-bottom:6px }
          input{ background:#151515; border:1px solid #2b2b2b; color:#ffffff; border-radius:12px; padding:10px 12px; width:100% }
          button{ border:0; border-radius:12px; padding:10px 14px; cursor:pointer; background:#04a156; color:white; box-shadow:0 6px 16px rgba(4,161,86,.35) }
          .row{ display:flex; gap:8px; align-items:center }
          .balance{ font-size:44px; font-weight:800; margin:8px 0 0; letter-spacing:.2px }
          .muted{ color:#cfcfcf; font-size:12px }
          .stats{ display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px; margin-top:12px }
          .stat{ background:#1c1c1c; border:1px solid #2b2b2b; border-radius:14px; padding:12px }
          .stat .label{ font-size:12px; color:#cfcfcf }
          .stat .value{ font-size:18px; font-weight:700; margin-top:4px }
          .stat .sub{ font-size:12px; color:#9a9a9a; margin-top:2px }
          .gain{ color:#3ae08e } .loss{ color:#ff6b6b }
          @media (max-width:520px){ .stats{ grid-template-columns: 1fr; } }
        </style>
        <div class="card">
          ${this.state.token ? `
            <div class="muted">Logged in as ${this.state.user?.email || ''}</div>
            <div class="balance">${usd}</div>
            <div class="muted">Current USD balance</div>
            ${this.state.last_updated ? `<div class="muted" style="margin-top:6px">Last Updated: ${this.state.last_updated}</div>` : ''}
            <div class="stats">
              <div class="stat">
                <div class="label">Balance</div>
                <div class="value">${usd}</div>
                <div class="sub">Current</div>
              </div>
              <div class="stat">
                <div class="label">Deposits</div>
                <div class="value">${dep}</div>
                <div class="sub">Total invested</div>
              </div>
              <div class="stat">
                <div class="label">Performance</div>
                <div class="value ${cls}">${perf}</div>
                <div class="sub">Since deposit</div>
              </div>
            </div>
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
