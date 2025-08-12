
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
      const r = await fetch(this.state.baseUrl + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
      const data = await r.json();
      if(r.ok){ this.setState({ token:data.token, user:data.user, balance_cents:data.balance_cents, deposit_cents:data.deposit_cents }); this.me(); }
      else alert(data.error || 'Login failed');
    }
    async me(){
      const r = await fetch(this.state.baseUrl + '/api/me', { headers:{ 'Authorization':'Bearer '+this.state.token }});
      if(r.ok){ const d = await r.json(); this.setState({ user:d.user, balance_cents:d.balance_cents, deposit_cents:d.deposit_cents, last_updated:d.last_updated }); }
    }
    render(){
      const bal = this.state.balance_cents;
      const dep = this.state.deposit_cents;
      const pl = bal - dep;
      const pct = dep > 0 ? (pl/dep)*100 : null;
      const usd = v => '$'+(v/100).toFixed(2);
      const perfPct = pct===null ? '—' : ((pl>=0?'+':'')+pct.toFixed(2)+'%');
      const perfDol = pct===null ? '—' : ((pl>=0?'+':'')+'$'+(Math.abs(pl)/100).toFixed(2));
      const pillClass = pct===null ? 'pill' : ('pill ' + (pl>=0?'green':'red'));

      this.shadowRoot.innerHTML = `
        <style>
          :host{ display:block; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
          .card{ background:#1e1e1e; color:#ffffff; border-radius:16px; box-shadow:0 14px 30px rgba(0,0,0,.35); padding:16px; max-width:520px }
          label{ display:block; font-size:12px; color:#cfcfcf; margin-bottom:6px }
          input{ background:#151515; border:1px solid #2b2b2b; color:#ffffff; border-radius:12px; padding:10px 12px; width:100% }
          button{ border:0; border-radius:12px; padding:10px 14px; cursor:pointer; background:#04a156; color:white; box-shadow:0 6px 16px rgba(4,161,86,.35) }
          .stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:8px }
          .stat{ background:#1a1a1a; border:1px solid #2b2b2b; border-radius:14px; padding:16px }
          .label{ font-size:12px; color:#cfcfcf; margin-bottom:6px }
          .value{ font-size:28px; font-weight:800 }
          .sub{ font-size:12px; color:#cfcfcf; margin-top:6px }
          .pill{ display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; font-weight:700 }
          .green{ background:#0d3d28; color:#8ef0be }
          .red{ background:#3d1210; color:#ffc0bd }
        </style>
        <div class="card">
          ${this.state.token ? `
            <div class="stats">
              <div class="stat"><div class="label">Balance</div><div class="value">${usd(bal)}</div><div class="sub">${this.state.last_updated ? 'Last Updated: '+this.state.last_updated : ''}</div></div>
              <div class="stat"><div class="label">Deposits</div><div class="value">${usd(dep)}</div><div class="sub">Total contributed</div></div>
              <div class="stat"><div class="label">Performance</div><div class="value"><span class="${pillClass}">${perfPct}</span> <span class="${pillClass}" style="margin-left:8px">${perfDol}</span></div><div class="sub">vs deposits</div></div>
            </div>
            <div style="margin-top:12px"><button id="refresh">Refresh</button> <button id="logout" style="background:#333">Log out</button></div>
          ` : `
            <form id="login">
              <div><label>Email</label><input id="email" placeholder="you@example.com" /></div>
              <div style="margin-top:8px"><label>Password</label><input id="password" type="password" placeholder="••••••••" /></div>
              <div style="margin-top:12px"><button type="submit">Log in</button></div>
              <div class="sub" style="margin-top:8px">Use your email and your six-digit investor ID.</div>
            </form>
          `}
        </div>
      `;
      if(this.state.token){
        this.shadowRoot.getElementById('refresh').onclick = () => this.me();
        this.shadowRoot.getElementById('logout').onclick = () => this.setState({ token:null, user:null, balance_cents:0, deposit_cents:0, last_updated:null });
      } else {
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
