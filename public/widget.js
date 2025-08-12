
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
      if(r.ok){ this.setState({ token:data.token, user:data.user, balance_cents:data.balance_cents, deposit_cents:data.deposit_cents }); this.me(); }
      else alert(data.error || 'Login failed');
    }
    async me(){
      const r = await fetch(this.state.baseUrl + '/api/me', { headers:{ 'Authorization':'Bearer '+this.state.token }});
      if(r.ok){ const d = await r.json(); this.setState({ user:d.user, balance_cents:d.balance_cents, deposit_cents:d.deposit_cents, last_updated:d.last_updated }); }
    }
    render(){
      const bal = this.state.balance_cents||0;
      const dep = this.state.deposit_cents||0;
      const perf = dep>0 ? ((bal-dep)/dep*100) : null;
      const usd = '$' + (bal/100).toFixed(2);
      const usdDep = '$' + (dep/100).toFixed(2);
      this.shadowRoot.innerHTML = `
        <style>
          :host{ display:block; font-family: inherit; }
          .card{ background:#1e1e1e; color:#ffffff; border-radius:14px; box-shadow:0 10px 25px rgba(0,0,0,.35); padding:16px; max-width:480px }
          .stats{ display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px }
          .stat{ background:#1b1b1b; border:1px solid #2b2b2b; border-radius:12px; padding:12px }
          .label{ font-size:12px; color:#cfcfcf }
          .value{ font-size:26px; font-weight:800; margin-top:6px }
          .value.big{ font-size:34px }
          .muted{ color:#cfcfcf; font-size:12px }
          input{ background:#151515; border:1px solid #2b2b2b; color:#ffffff; border-radius:12px; padding:10px 12px; width:100% }
          button{ border:0; border-radius:12px; padding:10px 14px; cursor:pointer; background:#04a156; color:white; box-shadow:0 6px 16px rgba(4,161,86,.35) }
          @media (max-width:520px){ .stats{ grid-template-columns:1fr } }
        </style>
        <div class="card">
          ${this.state.token ? `
            <div class="stats">
              <div class="stat">
                <div class="label">Balance</div>
                <div class="value big">${usd}</div>
              </div>
              <div class="stat">
                <div class="label">Deposits</div>
                <div class="value">${usdDep}</div>
              </div>
              <div class="stat">
                <div class="label">Performance</div>
                <div class="value" style="color:${perf==null?'#ffffff':(perf>=0?'#04a156':'#ff6b6b')}">
                  ${perf==null?'—':(perf>=0?'+':'')+perf.toFixed(2)+'%'}
                </div>
              </div>
            </div>
            ${this.state.last_updated ? `<div class="muted" style="margin-top:8px">Last Updated: ${this.state.last_updated}</div>` : ''}
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
              <div class="muted" style="margin-top:8px">Use your email and six-digit investor ID.</div>
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
