
(function(){
  class BalanceWidget extends HTMLElement{
    constructor(){
      super();
      this.attachShadow({ mode:'open' });
      this.state = { token:null, user:null, balance_cents:0, last_updated:null, baseUrl: this.getAttribute('data-base-url') || '' };
      this.render();
    }
    setState(p){ this.state = {...this.state, ...p}; this.render(); }
    async login(email, password){
      const r = await fetch(this.state.baseUrl + '/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if(r.ok){ this.setState({ token:data.token, user:data.user, balance_cents:data.balance_cents, last_updated:data.last_updated }); }
      else alert(data.error || 'Login failed');
    }
    async me(){
      const r = await fetch(this.state.baseUrl + '/api/me', { headers:{ 'Authorization':'Bearer '+this.state.token }});
      if(r.ok){ const d = await r.json(); this.setState({ user:d.user, balance_cents:d.balance_cents, last_updated:d.last_updated }); }
    }
    render(){
      const usd = '$' + (this.state.balance_cents/100).toFixed(2);
      this.shadowRoot.innerHTML = `
        <style>
          :host{ display:block; font-family: inherit; }
          .card{ background:#1e1e1e; color:#ffffff; border-radius:14px; box-shadow:0 10px 25px rgba(0,0,0,.35); padding:16px; max-width:460px }
          label{ display:block; font-size:12px; color:#cfcfcf; margin-bottom:6px }
          input{ background:#151515; border:1px solid #2b2b2b; color:#ffffff; border-radius:12px; padding:10px 12px; width:100% }
          button{ border:0; border-radius:12px; padding:10px 14px; cursor:pointer; background:#04a156; color:white; box-shadow:0 6px 16px rgba(4,161,86,.35) }
          .row{ display:flex; gap:8px; align-items:center }
          .balance{ font-size:42px; font-weight:800; margin:8px 0 0 }
          .muted{ color:#cfcfcf; font-size:12px }
        </style>
        <div class="card">
          ${this.state.token ? `
            <div class="muted">Logged in as ${this.state.user?.email || ''}</div>
            <div class="balance">${usd}</div>
            <div class="muted">Current USD balance</div>
            ${this.state.last_updated ? `<div class="muted" style="margin-top:6px">Last Updated: ${this.state.last_updated}</div>` : ''}
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
        this.shadowRoot.getElementById('logout').onclick = () => this.setState({ token:null, user:null, balance_cents:0, last_updated:null });
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
