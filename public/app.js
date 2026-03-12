const app = document.getElementById('app');
const state = { token: null, user: null, adminSelectedUserId: null, adminSelectedBalanceYear: null };

const fmtMoney = (cents) => {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(cents) / 100);
};
const fmtPct = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : `${Number(n).toFixed(2)}%`);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toUsdInputCents = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const centsToInput = (cents) => cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2);
const todayYear = () => new Date().getFullYear();
const uniqueYears = (rows, key) => [...new Set((rows || []).map((r) => Number(String(r[key]).slice(0, 4) || r[key])).filter(Boolean))].sort((a, b) => a - b);

function toast(msg, ok = true) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (!ok) el.classList.add('toast-bad');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ok ? 1800 : 2600);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    let message = 'Request failed';
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

function buildChartSvg(points, opts = {}) {
  if (!points || !points.length) return '<div class="empty-state">No data entered yet.</div>';
  const width = opts.width || 860;
  const height = opts.height || 300;
  const pad = { left: opts.type === 'bar' ? 74 : 56, right: opts.type === 'bar' ? 28 : 18, top: 12, bottom: 38 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  let minY = opts.minY !== undefined ? opts.minY : rawMinY;
  let maxY = opts.maxY !== undefined ? opts.maxY : rawMaxY;

  if (opts.smartScale && opts.type !== 'bar') {
    const range = rawMaxY - rawMinY;
    const fallbackPad = Math.max(Math.abs(rawMaxY || 0) * 0.03, 1);
    const yPad = range > 0 ? Math.max(range * 0.18, fallbackPad) : fallbackPad;
    const candidateMin = rawMinY - yPad;
    const nearZero = rawMinY <= yPad * 1.35;
    minY = opts.minY !== undefined ? opts.minY : (nearZero ? 0 : Math.max(0, candidateMin));
    maxY = opts.maxY !== undefined ? opts.maxY : (rawMaxY + yPad);
  }

  if (opts.allowNegative && minY > 0) minY = 0;
  if (!opts.allowNegative && !opts.smartScale) minY = Math.max(0, minY);
  if (maxY === minY) {
    if (maxY === 0) maxY = 1;
    else {
      const padAmt = Math.max(Math.abs(maxY) * 0.05, 1);
      minY = opts.smartScale ? Math.max(0, minY - padAmt) : Math.min(0, minY);
      maxY += padAmt;
    }
  }
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const yScale = (y) => pad.top + (1 - ((y - minY) / (maxY - minY))) * plotH;
  const zeroY = minY <= 0 && maxY >= 0 ? yScale(0) : null;
  const ticks = 4;
  const yTickMarkup = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = minY + ((maxY - minY) * i) / ticks;
    const y = yScale(v);
    return `
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid" />
      <text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="chart-label">${escapeHtml(fmtMoney(Math.round(v * 100)))}</text>`;
  }).join('');

  if (opts.type === 'bar') {
    const step = plotW / Math.max(points.length, 1);
    const barW = Math.min(72, Math.max(24, step * 0.52));
    const bars = points.map((p, i) => {
      const centerX = pad.left + (step * i) + (step / 2);
      const baseY = zeroY === null ? yScale(minY) : zeroY;
      const y = yScale(p.y);
      const x = centerX - barW / 2;
      const h = Math.max(1, Math.abs(baseY - y));
      return `
        <rect x="${x.toFixed(1)}" y="${Math.min(y, baseY).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" class="chart-bar ${p.y < 0 ? 'negative' : 'positive'}" />
        <text x="${centerX.toFixed(1)}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeHtml(p.label)}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Chart">
      ${yTickMarkup}
      ${zeroY !== null ? `<line x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" class="chart-zero" />` : ''}
      ${bars}
    </svg>`;
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let linePoints = points;
  if (maxX === minX) {
    const single = points[0];
    linePoints = [
      { ...single, x: single.x - 1 },
      single,
      { ...single, x: single.x + 1 }
    ];
  }
  const xScale = (x) => pad.left + ((x - Math.min(...linePoints.map((p) => p.x))) / (Math.max(...linePoints.map((p) => p.x)) - Math.min(...linePoints.map((p) => p.x)))) * plotW;
  const line = linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L ${xScale(linePoints[linePoints.length - 1].x).toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${xScale(linePoints[0].x).toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;
  const xLabels = [linePoints[0], linePoints[Math.floor((linePoints.length - 1) / 2)], linePoints[linePoints.length - 1]].filter((v, i, arr) => arr.findIndex((x) => x.label === v.label) === i)
    .map((p) => `<text x="${xScale(p.x)}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeHtml(p.label)}</text>`).join('');

  const tooltipText = (p) => escapeHtml(opts.pointTooltip ? opts.pointTooltip(p) : `${p.label}: ${fmtMoney(Math.round(p.y * 100))}`);
  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Chart">
    ${yTickMarkup}
    ${zeroY !== null ? `<line x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" class="chart-zero" />` : ''}
    <path d="${area}" class="chart-area" /><path d="${line}" class="chart-line" />
    ${linePoints.map((p) => `<g class="chart-point"><circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="3.5" class="chart-dot" /><circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="11" class="chart-hit" /><title>${tooltipText(p)}</title></g>`).join('')}
    ${xLabels}
  </svg>`;
}

function computeBalanceViews(balanceHistory) {
  const rows = (balanceHistory || [])
    .filter((r) => r.as_of_date && r.balance_cents !== null && r.balance_cents !== undefined)
    .map((r) => ({ ...r, ts: new Date(`${r.as_of_date}T00:00:00`).getTime(), balance_cents: Math.max(0, Number(r.balance_cents) || 0) }))
    .sort((a, b) => a.ts - b.ts);
  const latest = rows[rows.length - 1];
  const currentYear = latest ? Number(String(latest.as_of_date).slice(0, 4)) : todayYear();
  const currentYearRows = rows.filter((r) => Number(String(r.as_of_date).slice(0, 4)) === currentYear);
  const yearStartTs = currentYearRows[0]?.ts ?? null;
  const monthlyCutoff = latest ? latest.ts - (30 * 24 * 60 * 60 * 1000) : null;
  const yearlyCutoff = latest ? latest.ts - (52 * 7 * 24 * 60 * 60 * 1000) : null;

  const views = {
    yearly: rows.filter((r) => latest ? r.ts >= yearlyCutoff : true),
    monthly: rows.filter((r) => latest ? r.ts >= monthlyCutoff : true),
    ytd: rows.filter((r) => yearStartTs ? r.ts >= yearStartTs : false),
    all: rows
  };
  return views;
}

function renderLastUpdatedSection(parent) {
  api('/api/public-stats').then((stats) => {
    if (!stats.last_updated) return;
    const card = document.createElement('div');
    card.className = 'card compact-card';
    card.innerHTML = `<div class="subtle">Last updated: <strong>${escapeHtml(stats.last_updated)}</strong></div>`;
    parent.appendChild(card);
  }).catch(() => {});
}

function renderLogin() {
  app.innerHTML = '';
  const acct = document.getElementById('siteHeaderAcct');
  if (acct) acct.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card login-card';
  card.innerHTML = `
    <h1>Investor Portal</h1>
    <div class="subtle">Sign in to view account information.</div>
    <div class="row wrap-row login-row">
      <input id="email" type="email" placeholder="Email" />
      <input id="password" type="password" placeholder="Password" />
      <button id="login">Login</button>
    </div>`;
  app.appendChild(card);
  card.querySelector('#login').onclick = async () => {
    const email = card.querySelector('#email').value.trim();
    const password = card.querySelector('#password').value.trim();
    if (!email || !password) return toast('Enter email and password.', false);
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      state.token = data.token;
      state.user = data.user;
      renderHome();
    } catch (e) {
      toast(e.message || 'Login failed.', false);
    }
  };
}

function renderSummaryCards(container, bundle) {
  const { user } = bundle;
  const bal = Number(user.balance_cents || 0);
  const dep = Number(user.deposit_cents || 0);
  const change = bal - dep;
  const pct = dep > 0 ? (change / dep) * 100 : null;
  const tone = pct === null ? 'neutral' : change >= 0 ? 'pos' : 'neg';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Account Summary</h2>
    <div class="stats">
      <div class="stat"><div class="label">Total Invested</div><div class="value">${fmtMoney(dep)}</div></div>
      <div class="stat"><div class="label">Current NAV</div><div class="value">${fmtMoney(bal)}</div></div>
      <div class="stat perf-big"><div class="label">Return</div><div class="value"><span class="${tone}">${pct === null ? '—' : `${fmtPct(pct)} (${fmtMoney(change)})`}</span></div></div>
    </div>`;
  container.appendChild(card);
}

function renderBalanceSection(container, bundle) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Balance History</h2>
        <div class="subtle">Default view shows the last 52 weeks with available entries only.</div>
      </div>
      <div class="toggle-group" id="balanceToggles">
        <button class="toggle active" data-view="yearly">Yearly</button>
        <button class="toggle" data-view="monthly">Monthly</button>
        <button class="toggle" data-view="ytd">YTD</button>
        <button class="toggle" data-view="all">All-Time</button>
      </div>
    </div>
    <div class="stats four compact-stats" id="balanceStats"></div>
    <div class="chart-wrap" id="balanceChart"></div>`;
  container.appendChild(card);

  const views = computeBalanceViews(bundle.balanceHistory || []);
  const chartEl = card.querySelector('#balanceChart');
  const statsEl = card.querySelector('#balanceStats');
  const labelMap = { yearly: 'Last 52 Weeks', monthly: 'Monthly', ytd: 'YTD', all: 'All-Time' };

  function draw(viewKey) {
    const rows = views[viewKey] || [];
    if (!rows.length) {
      chartEl.innerHTML = '<div class="empty-state">No weekly balance entries have been added yet.</div>';
      statsEl.innerHTML = '<div class="stat"><div class="label">Range</div><div class="value">—</div></div><div class="stat"><div class="label">Start</div><div class="value">—</div></div><div class="stat"><div class="label">Latest</div><div class="value">—</div></div><div class="stat"><div class="label">Change</div><div class="value">—</div></div>';
      return;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const delta = last.balance_cents - first.balance_cents;
    const pct = first.balance_cents > 0 ? (delta / first.balance_cents) * 100 : null;
    const tone = pct === null ? 'neutral' : delta >= 0 ? 'pos' : 'neg';
    statsEl.innerHTML = `
      <div class="stat"><div class="label">Range</div><div class="value small-value">${labelMap[viewKey]}</div></div>
      <div class="stat"><div class="label">Start</div><div class="value small-value">${fmtMoney(first.balance_cents)}</div><div class="subtle">${first.as_of_date}</div></div>
      <div class="stat"><div class="label">Latest</div><div class="value small-value">${fmtMoney(last.balance_cents)}</div><div class="subtle">${last.as_of_date}</div></div>
      <div class="stat"><div class="label">Change</div><div class="value small-value"><span class="${tone}">${fmtMoney(delta)}${pct === null ? '' : ` · ${fmtPct(pct)}`}</span></div></div>`;
    chartEl.innerHTML = buildChartSvg(
      rows.map((r) => ({ x: r.ts, y: r.balance_cents / 100, label: r.as_of_date })),
      {
        smartScale: true,
        pointTooltip: (p) => `${p.label} · ${fmtMoney(Math.round(p.y * 100))}`
      }
    );
  }

  card.querySelectorAll('.toggle').forEach((btn) => {
    btn.onclick = () => {
      card.querySelectorAll('.toggle').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      draw(btn.dataset.view);
    };
  });
  draw('yearly');
}

function renderNetDepositsSection(container, bundle) {
  const rows = (bundle.yearlyTotals || []).slice().sort((a, b) => a.year - b.year);
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Net Deposits by Year</h2>
    <div class="subtle">Negative values are displayed below zero.</div>
    <div class="chart-wrap">${buildChartSvg(rows.map((r, i) => ({ x: i + 1, y: (Number(r.net_deposits_cents) || 0) / 100, label: String(r.year) })), { type: 'bar', allowNegative: true, minY: Math.min(0, ...rows.map((r) => (Number(r.net_deposits_cents) || 0) / 100)) })}</div>`;
  container.appendChild(card);
}

function renderTransactionsSection(container, bundle) {
  const rows = bundle.transactions || [];
  const card = document.createElement('div');
  card.className = 'card';
  const body = rows.length ? rows.map((tx) => `
    <tr>
      <td>${escapeHtml(tx.tx_date)}</td>
      <td>${escapeHtml(tx.tx_type === 'redemption' ? 'Redemption' : 'Deposit')}</td>
      <td>${fmtMoney(tx.amount_cents)}</td>
      <td>${tx.nav_per_share_cents === null || tx.nav_per_share_cents === undefined ? '—' : fmtMoney(tx.nav_per_share_cents)}</td>
      <td>${escapeHtml(tx.notes || '')}</td>
    </tr>`).join('') : '<tr><td colspan="5">No transactions entered yet.</td></tr>';
  card.innerHTML = `
    <h2>Deposits and Withdrawals</h2>
    <div class="table-wrap">
      <table class="table mono">
        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>NAV / Share</th><th>Notes</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  container.appendChild(card);
}

function renderPasswordChange(container) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2>Change Password</h2>
    <div class="row wrap-row">
      <input id="curPwd" type="password" placeholder="Current password" />
      <input id="newPwd" type="password" placeholder="New password" />
      <input id="newPwd2" type="password" placeholder="Confirm new password" />
      <button id="savePwd">Update</button>
    </div>`;
  container.appendChild(card);
  card.querySelector('#savePwd').onclick = async () => {
    const a = card.querySelector('#curPwd').value.trim();
    const b = card.querySelector('#newPwd').value.trim();
    const c = card.querySelector('#newPwd2').value.trim();
    if (!a || !b || !c) return toast('Fill all password fields.', false);
    if (b !== c) return toast('New passwords do not match.', false);
    try {
      await api('/api/me/password', { method: 'PATCH', body: JSON.stringify({ current_password: a, new_password: b }) });
      toast('Password updated.');
      card.querySelectorAll('input').forEach((i) => { i.value = ''; });
    } catch (e) {
      toast(e.message || 'Password update failed.', false);
    }
  };
}

function makeTableRow(cells, rowClass = '') {
  const tr = document.createElement('tr');
  if (rowClass) tr.className = rowClass;
  tr.innerHTML = cells.join('');
  return tr;
}

function renderAdmin(container) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h2>Admin Portal</h2><div class="admin-shell"><div id="adminSidebar" class="admin-sidebar"></div><div id="adminDetail" class="admin-detail"></div></div>`;
  container.appendChild(card);
  const sidebar = card.querySelector('#adminSidebar');
  const detail = card.querySelector('#adminDetail');

  async function refreshSidebar(selectId = state.adminSelectedUserId) {
    const users = await api('/api/admin/users');
    if (!state.adminSelectedUserId) {
      const firstUser = users.find((u) => u.role !== 'admin') || users[0];
      state.adminSelectedUserId = firstUser?.id || null;
    }
    if (selectId) state.adminSelectedUserId = selectId;
    sidebar.innerHTML = `
      <div class="card inner-card">
        <h3>Create User</h3>
        <div class="stack-sm">
          <input id="newEmail" type="email" placeholder="Investor email" />
          <input id="newPass" type="text" placeholder="Optional password" />
          <button id="createUser">Add Investor</button>
          <div class="subtle">Leave password blank to generate a temporary password.</div>
        </div>
      </div>
      <div class="card inner-card">
        <h3>Investors</h3>
        <div class="investor-list" id="investorList"></div>
      </div>
      <div class="card inner-card">
        <h3>Settings</h3>
        <div class="stack-sm">
          <input id="lastUpdated" placeholder="Last Updated (YYYY-MM-DD)" />
          <button id="saveLastUpdated">Save</button>
        </div>
      </div>`;

    const list = sidebar.querySelector('#investorList');
    users.forEach((u) => {
      const btn = document.createElement('button');
      btn.className = `investor-item ${u.id === state.adminSelectedUserId ? 'active' : ''}`;
      btn.innerHTML = `<span>${escapeHtml(u.email)}</span><span class="pill">${u.role}</span>`;
      btn.onclick = () => { state.adminSelectedUserId = u.id; refreshSidebar(u.id); loadDetail(u.id); };
      list.appendChild(btn);
    });

    sidebar.querySelector('#createUser').onclick = async () => {
      const email = sidebar.querySelector('#newEmail').value.trim();
      const password = sidebar.querySelector('#newPass').value.trim();
      if (!email) return toast('Email required.', false);
      try {
        const created = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, password: password || undefined }) });
        toast(`User created${created.temp_password ? ` — temp password: ${created.temp_password}` : ''}`);
        await refreshSidebar(created.id);
        loadDetail(created.id);
      } catch (e) {
        toast(e.message || 'Create failed.', false);
      }
    };

    try {
      const settings = await api('/api/admin/last-updated');
      sidebar.querySelector('#lastUpdated').value = settings.last_updated || '';
    } catch {}
    sidebar.querySelector('#saveLastUpdated').onclick = async () => {
      try {
        await api('/api/admin/last-updated', { method: 'POST', body: JSON.stringify({ last_updated: sidebar.querySelector('#lastUpdated').value.trim() }) });
        toast('Last updated saved.');
      } catch (e) {
        toast(e.message || 'Save failed.', false);
      }
    };
  }

  async function loadDetail(id) {
    detail.innerHTML = '<div class="card inner-card"><div class="subtle">Loading investor data...</div></div>';
    try {
      const bundle = await api(`/api/admin/users/${id}`);
      detail.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'card inner-card';
      header.innerHTML = `
        <div class="section-head">
          <div>
            <h3>${escapeHtml(bundle.user.email)}</h3>
            <div class="subtle">Manual account maintenance for this investor.</div>
          </div>
          <div class="row wrap-row">
            <button id="resetPwdBtn">Reset Password</button>
            ${bundle.user.role === 'admin' ? '' : '<button id="deleteUserBtn" class="danger-btn">Delete User</button>'}
          </div>
        </div>`;
      detail.appendChild(header);

      header.querySelector('#resetPwdBtn').onclick = async () => {
        try {
          const resp = await api(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
          toast(`Temp password: ${resp.password}`);
        } catch (e) {
          toast(e.message || 'Reset failed.', false);
        }
      };
      const deleteBtn = header.querySelector('#deleteUserBtn');
      if (deleteBtn) {
        deleteBtn.onclick = async () => {
          if (!confirm(`Delete ${bundle.user.email}?`)) return;
          try {
            await api(`/api/admin/users/${id}`, { method: 'DELETE' });
            toast('User deleted.');
            state.adminSelectedUserId = null;
            await refreshSidebar();
            if (state.adminSelectedUserId) loadDetail(state.adminSelectedUserId);
            else detail.innerHTML = '<div class="card inner-card"><div class="subtle">No investor selected.</div></div>';
          } catch (e) {
            toast(e.message || 'Delete failed.', false);
          }
        };
      }

      renderAdminSummarySection(detail, bundle, refreshSidebar);
      renderAdminYearlyTotalsSection(detail, bundle);
      renderAdminBalancesSection(detail, bundle);
      renderAdminTransactionsSection(detail, bundle);
    } catch (e) {
      detail.innerHTML = `<div class="card inner-card"><div class="subtle">${escapeHtml(e.message || 'Failed to load investor.')}</div></div>`;
    }
  }

  function renderAdminSummarySection(parent, bundle, sidebarRefresh) {
    const sec = document.createElement('div');
    sec.className = 'card inner-card';
    sec.innerHTML = `
      <h3>Overview</h3>
      <div class="grid two-col">
        <div>
          <label>Total Invested (USD)</label>
          <input id="totalInvested" value="${escapeHtml(centsToInput(bundle.user.deposit_cents))}" />
        </div>
        <div>
          <label>Current NAV (USD)</label>
          <input id="currentNav" value="${escapeHtml(centsToInput(bundle.user.balance_cents))}" />
        </div>
      </div>
      <div class="subtle">These top-line values are entered manually and displayed in the investor dashboard summary.</div>
      <div class="top-gap"><button id="saveOverview">Save Overview</button></div>`;
    parent.appendChild(sec);
    sec.querySelector('#saveOverview').onclick = async () => {
      try {
        await api(`/api/admin/users/${bundle.user.id}/summary`, {
          method: 'PATCH',
          body: JSON.stringify({
            deposit_cents: toUsdInputCents(sec.querySelector('#totalInvested').value),
            balance_cents: toUsdInputCents(sec.querySelector('#currentNav').value)
          })
        });
        toast('Overview saved.');
        sidebarRefresh(bundle.user.id);
      } catch (e) {
        toast(e.message || 'Save failed.', false);
      }
    };
  }

  function renderAdminYearlyTotalsSection(parent, bundle) {
    const sec = document.createElement('div');
    sec.className = 'card inner-card';
    const rows = (bundle.yearlyTotals || []).slice().sort((a, b) => a.year - b.year);
    sec.innerHTML = `
      <h3>Net Deposits by Year</h3>
      <div class="subtle">Enter one row per year. Negative values are allowed.</div>
      <div class="table-wrap"><table class="table mono"><thead><tr><th>Year</th><th>Net Deposits (USD)</th><th></th></tr></thead><tbody id="yearlyBody"></tbody></table></div>
      <div class="row wrap-row top-gap"><button id="addYearlyRow">Add Year</button><button id="saveYearlyRows">Save Net Deposits</button></div>`;
    parent.appendChild(sec);
    const tbody = sec.querySelector('#yearlyBody');

    const addRow = (year = '', value = '') => {
      const tr = makeTableRow([
        `<td><input class="year-input" value="${escapeHtml(year)}" placeholder="2026" /></td>`,
        `<td><input class="money-input" value="${escapeHtml(value)}" placeholder="0.00" /></td>`,
        `<td><button class="ghost-btn delete-row">Remove</button></td>`
      ]);
      tr.querySelector('.delete-row').onclick = () => tr.remove();
      tbody.appendChild(tr);
    };
    rows.forEach((r) => addRow(String(r.year), centsToInput(r.net_deposits_cents)));
    if (!rows.length) addRow(String(todayYear()), '');
    sec.querySelector('#addYearlyRow').onclick = () => addRow(String(todayYear()), '');
    sec.querySelector('#saveYearlyRows').onclick = async () => {
      const payload = [...tbody.querySelectorAll('tr')].map((tr) => ({
        year: tr.querySelector('.year-input').value.trim(),
        net_deposits_cents: toUsdInputCents(tr.querySelector('.money-input').value)
      }));
      try {
        await api(`/api/admin/users/${bundle.user.id}/yearly-totals`, { method: 'PUT', body: JSON.stringify({ rows: payload }) });
        toast('Net deposits saved.');
        loadDetail(bundle.user.id);
      } catch (e) {
        toast(e.message || 'Save failed.', false);
      }
    };
  }

  function renderAdminBalancesSection(parent, bundle) {
    const sec = document.createElement('div');
    sec.className = 'card inner-card';
    const years = [...new Set([2024, 2025, 2026, todayYear(), ...uniqueYears(bundle.balanceHistory || [], 'as_of_date')])].sort((a, b) => a - b);
    const defaultYear = state.adminSelectedBalanceYear && years.includes(Number(state.adminSelectedBalanceYear))
      ? String(state.adminSelectedBalanceYear)
      : String(years[years.length - 1] || todayYear());
    sec.innerHTML = `
      <div class="section-head">
        <div>
          <h3>Weekly Balances</h3>
          <div class="subtle">Save one year at a time. Dates are fully manual.</div>
        </div>
        <select id="balanceYearSelect">${years.map((y) => `<option value="${y}" ${String(y) === defaultYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table class="table mono"><thead><tr><th>Date</th><th>Balance (USD)</th><th></th></tr></thead><tbody id="balanceBody"></tbody></table></div>
      <div class="subtle top-gap" id="balanceValidationHint">Each row must have a unique date inside the selected year.</div>
      <div class="row wrap-row top-gap"><button id="addBalanceRow">Add Balance Row</button><button id="saveBalanceRows">Save Selected Year</button></div>`;
    parent.appendChild(sec);
    const tbody = sec.querySelector('#balanceBody');
    const yearSelect = sec.querySelector('#balanceYearSelect');
    const addButton = sec.querySelector('#addBalanceRow');
    const saveButton = sec.querySelector('#saveBalanceRows');

    const addRow = (date = '', value = '') => {
      const tr = makeTableRow([
        `<td><input class="date-input" type="date" value="${escapeHtml(date)}" /></td>`,
        `<td><input class="money-input" value="${escapeHtml(value)}" placeholder="0.00" /></td>`,
        `<td><button class="ghost-btn delete-row">Remove</button></td>`
      ]);
      tr.querySelector('.delete-row').onclick = () => tr.remove();
      tbody.appendChild(tr);
    };

    const drawYear = () => {
      state.adminSelectedBalanceYear = yearSelect.value;
      tbody.innerHTML = '';
      const selected = yearSelect.value;
      const rows = (bundle.balanceHistory || []).filter((r) => String(r.as_of_date).startsWith(selected)).sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
      rows.forEach((r) => addRow(r.as_of_date, centsToInput(r.balance_cents)));
      if (!rows.length) addRow('', '');
    };

    addButton.onclick = () => addRow('', '');
    drawYear();
    yearSelect.onchange = drawYear;
    saveButton.onclick = async () => {
      const selectedYear = yearSelect.value;
      state.adminSelectedBalanceYear = selectedYear;
      const errors = [];
      const seen = new Set();
      const payload = [];
      [...tbody.querySelectorAll('tr')].forEach((tr, idx) => {
        const date = tr.querySelector('.date-input').value;
        const valueRaw = tr.querySelector('.money-input').value;
        const cents = toUsdInputCents(valueRaw);
        if (!date && (valueRaw === '' || valueRaw === null)) return;
        if (!date || cents === null) {
          errors.push(`Row ${idx + 1} is missing a valid date or balance.`);
          return;
        }
        if (!date.startsWith(selectedYear)) {
          errors.push(`Row ${idx + 1} must use a ${selectedYear} date.`);
          return;
        }
        if (seen.has(date)) {
          errors.push(`Row ${idx + 1} repeats ${date}.`);
          return;
        }
        seen.add(date);
        payload.push({ as_of_date: date, balance_cents: cents });
      });
      if (errors.length) return toast(errors[0], false);
      try {
        await api(`/api/admin/users/${bundle.user.id}/balance-history/${selectedYear}`, { method: 'PUT', body: JSON.stringify({ rows: payload }) });
        toast(`Saved ${payload.length} balance row${payload.length === 1 ? '' : 's'} for ${selectedYear}.`);
        loadDetail(bundle.user.id);
      } catch (e) {
        toast(e.message || 'Save failed.', false);
      }
    };
  }

  function renderAdminTransactionsSection(parent, bundle) {
    const sec = document.createElement('div');
    sec.className = 'card inner-card';
    const rows = (bundle.transactions || []).slice().sort((a, b) => a.tx_date.localeCompare(b.tx_date));
    sec.innerHTML = `
      <h3>Transactions</h3>
      <div class="subtle">Date, amount, and NAV/share are entered manually.</div>
      <div class="table-wrap"><table class="table mono"><thead><tr><th>Date</th><th>Type</th><th>Amount (USD)</th><th>NAV / Share (USD)</th><th>Notes</th><th></th></tr></thead><tbody id="txBody"></tbody></table></div>
      <div class="row wrap-row top-gap"><button id="addTxRow">Add Transaction</button><button id="saveTxRows">Save Transactions</button></div>`;
    parent.appendChild(sec);
    const tbody = sec.querySelector('#txBody');
    const addRow = (tx = {}) => {
      const tr = makeTableRow([
        `<td><input class="date-input" type="date" value="${escapeHtml(tx.tx_date || '')}" /></td>`,
        `<td><select class="type-input"><option value="deposit" ${tx.tx_type === 'deposit' ? 'selected' : ''}>Deposit</option><option value="redemption" ${tx.tx_type === 'redemption' ? 'selected' : ''}>Redemption</option></select></td>`,
        `<td><input class="money-input amount-input" value="${escapeHtml(centsToInput(tx.amount_cents))}" placeholder="0.00" /></td>`,
        `<td><input class="money-input nav-input" value="${escapeHtml(centsToInput(tx.nav_per_share_cents))}" placeholder="0.00" /></td>`,
        `<td><input class="notes-input" value="${escapeHtml(tx.notes || '')}" placeholder="Optional" /></td>`,
        `<td><button class="ghost-btn delete-row">Remove</button></td>`
      ]);
      tr.querySelector('.delete-row').onclick = () => tr.remove();
      tbody.appendChild(tr);
    };
    rows.forEach(addRow);
    if (!rows.length) addRow({});
    sec.querySelector('#addTxRow').onclick = () => addRow({});
    sec.querySelector('#saveTxRows').onclick = async () => {
      const payload = [...tbody.querySelectorAll('tr')].map((tr) => ({
        tx_date: tr.querySelector('.date-input').value,
        tx_type: tr.querySelector('.type-input').value,
        amount_cents: toUsdInputCents(tr.querySelector('.amount-input').value),
        nav_per_share_cents: toUsdInputCents(tr.querySelector('.nav-input').value),
        notes: tr.querySelector('.notes-input').value.trim()
      }));
      try {
        await api(`/api/admin/users/${bundle.user.id}/transactions`, { method: 'PUT', body: JSON.stringify({ rows: payload }) });
        toast('Transactions saved.');
        loadDetail(bundle.user.id);
      } catch (e) {
        toast(e.message || 'Save failed.', false);
      }
    };
  }

  refreshSidebar().then(() => {
    if (state.adminSelectedUserId) loadDetail(state.adminSelectedUserId);
    else detail.innerHTML = '<div class="card inner-card"><div class="subtle">No investor selected.</div></div>';
  }).catch((e) => {
    detail.innerHTML = `<div class="card inner-card"><div class="subtle">${escapeHtml(e.message || 'Failed to load admin portal.')}</div></div>`;
  });
}

function renderHome() {
  app.innerHTML = '';
  const acct = document.getElementById('siteHeaderAcct');
  if (acct) {
    acct.innerHTML = `<div class="row wrap-row"><div class="subtle">${escapeHtml(state.user.email)} (${escapeHtml(state.user.role)})</div><button id="logout">Logout</button></div>`;
    acct.querySelector('#logout').onclick = () => {
      state.token = null;
      state.user = null;
      state.adminSelectedUserId = null;
      renderLogin();
    };
  }
  renderLastUpdatedSection(app);
  api('/api/me').then((bundle) => {
    state.user = bundle.user;
    renderSummaryCards(app, bundle);
    renderBalanceSection(app, bundle);
    renderNetDepositsSection(app, bundle);
    renderTransactionsSection(app, bundle);
    renderPasswordChange(app);
    if (bundle.user.role === 'admin') renderAdmin(app);
  }).catch((e) => toast(e.message || 'Failed to load profile.', false));
}

renderLogin();
