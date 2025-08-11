
(function(){
  class BalanceWidget extends HTMLElement{
    constructor(){
      super();
      this.attachShadow({ mode:'open' });
      this.state = { token:null, user:null, balance_cents:0, baseUrl: this.getAttribute('data-base-url') || '' };
      this.render();
    }
    connectedCallback(){}
    setState(p){ this.state = {...this.state, ...p}; this.render(); }
    async login(email, password){
      const r = await fetch(this.state.baseUrl + '/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if(r.ok){ this.setState({ token:data.token, user:data.user, balance_cents:data.balance_cents }); }
      else alert(data.error || 'Login failed');
    }
    async me(){
      const r = await fetch(this.state.baseUrl + '/api/me', { headers:{ 'Authorization':'Bearer '+this.state.token }});
      if(r.ok){ const d = await r.json(); this.setState({ user:d.user, balance_cents:d.balance_cents }); }
    }
    render(){
      const usd = '$' + (this.state.balance_cents/100).toFixed(2);
      this.shadowRoot.innerHTML = `
        <style>
          :host{ display:block; font-family: inherit; }
          .card{ background:#0f172a; color:#e2e8f0; border-radius:14px; box-shadow:0 10px 25px rgba(0,0,0,.25); padding:16px; max-width:420px }
          label{ display:block; font-size:12px; color:#94a3b8; margin-bottom:6px }
          input{ background:#0b1b35; border:1px solid #1e293b; color:#e2e8f0; border-radius:12px; padding:10px 12px; width:100% }
          button{ border:0; border-radius:12px; padding:10px 14px; cursor:pointer; background:#2563eb; color:white; box-shadow:0 6px 16px rgba(37,99,235,.4) }
          .row{ display:flex; gap:8px; align-items:center }
          .balance{ font-size:28px; font-weight:700; margin:8px 0 0 }
          .muted{ color:#94a3b8; font-size:12px }
        </style>
        <div class="card">
          ${this.state.token ? `
            <div class="muted">Logged in as ${this.state.user?.email || ''}</div>
            <div class="balance">${usd}</div>
            <div class="muted">Current USD balance</div>
            <div style="margin-top:12px" class="row">
              <button id="refresh">Refresh</button>
              <button id="logout" style="background:#1f2937">Log out</button>
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
              <div class="muted" style="margin-top:8px">Don’t have an account? Ask your admin to create one.</div>
            </form>
          `}
        </div>
      `;
      if(this.state.token){
        this.shadowRoot.getElementById('refresh').onclick = () => this.me();
        this.shadowRoot.getElementById('logout').onclick = () => this.setState({ token:null, user:null, balance_cents:0 });
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
