const app = document.getElementById('app');
const state = { token: null, user: null, adminSelectedUserId: null, adminSelectedBalanceYear: null, adminSort: 'label_asc', publicNavLoaded: false };

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

const parseISODate = (value) => {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const formatDatePretty = (value) => {
  const d = parseISODate(value);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : value || '—';
};
const addDaysIso = (value, days) => {
  const d = parseISODate(value);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const getInvestorLabel = (user) => (user?.display_label || user?.email || 'Investor').trim();
const sortAdminUsers = (users, sortKey) => {
  const items = [...(users || [])];
  const labelCmp = (a, b) => getInvestorLabel(a).localeCompare(getInvestorLabel(b), undefined, { sensitivity: 'base' });
  const num = (value) => Number(value || 0);
  items.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    switch (sortKey) {
      case 'nav_desc': return num(b.balance_cents) - num(a.balance_cents) || labelCmp(a, b);
      case 'invested_desc': return num(b.deposit_cents) - num(a.deposit_cents) || labelCmp(a, b);
      case 'return_desc': {
        const ar = num(a.deposit_cents) > 0 ? (num(a.balance_cents) - num(a.deposit_cents)) / num(a.deposit_cents) : -Infinity;
        const br = num(b.deposit_cents) > 0 ? (num(b.balance_cents) - num(b.deposit_cents)) / num(b.deposit_cents) : -Infinity;
        return br - ar || labelCmp(a, b);
      }
      case 'label_desc': return labelCmp(b, a);
      case 'label_asc':
      default: return labelCmp(a, b);
    }
  });
  return items;
};
function summarizeTransactionsByDate(transactions) {
  const map = new Map();
  (transactions || []).forEach((tx) => {
    if (!tx?.tx_date) return;
    const existing = map.get(tx.tx_date) || {
      count: 0,
      deposit_cents: 0,
      redemption_cents: 0,
      items: []
    };
    existing.count += 1;
    if (tx.tx_type === 'redemption') existing.redemption_cents += Number(tx.amount_cents || 0);
    else existing.deposit_cents += Number(tx.amount_cents || 0);
    existing.items.push(tx);
    map.set(tx.tx_date, existing);
  });
  return map;
}
function buildTransactionMarker(date, txSummary) {
  if (!txSummary) return null;
  const hasDeposit = txSummary.deposit_cents > 0;
  const hasRedemption = txSummary.redemption_cents > 0;
  const lines = [formatDatePretty(date)];
  if (hasDeposit && hasRedemption) {
    lines.push(`Balance ${fmtMoney(0)}`);
    lines.push(`Deposit ${fmtMoney(txSummary.deposit_cents)}`);
    lines.push(`Redemption ${fmtMoney(txSummary.redemption_cents)}`);
  } else if (hasDeposit) {
    lines.push(`Balance ${fmtMoney(0)}`);
    lines.push(`Deposit ${fmtMoney(txSummary.deposit_cents)}`);
  } else if (hasRedemption) {
    lines.push(`Balance ${fmtMoney(0)}`);
    lines.push(`Redemption ${fmtMoney(txSummary.redemption_cents)}`);
  }
  txSummary.items.slice(0, 2).forEach((item) => {
    if (item.notes) lines.push(item.notes);
  });
  return {
    kind: hasDeposit && hasRedemption ? 'mixed' : hasRedemption ? 'redemption' : 'deposit',
    lines
  };
}

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
  const pad = { left: opts.type === 'bar' ? 74 : 56, right: opts.type === 'bar' ? 28 : 18, top: 14, bottom: 38 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);
  let minY = opts.minY !== undefined ? opts.minY : rawMinY;
  let maxY = opts.maxY !== undefined ? opts.maxY : rawMaxY;

  const range = rawMaxY - rawMinY;
  const basePad = Math.max(range * 0.16, Math.abs(rawMaxY || 0) * 0.04, 1);

  if (opts.smartScale) {
    if (opts.type === 'bar') {
      if (opts.allowNegative) {
        if (rawMinY >= 0) {
          minY = 0;
          maxY = rawMaxY + basePad;
        } else if (rawMaxY <= 0) {
          minY = rawMinY - basePad;
          maxY = 0;
        } else {
          minY = rawMinY - Math.max(basePad * 0.75, 1);
          maxY = rawMaxY + Math.max(basePad * 0.9, 1.25);
        }
      } else {
        minY = Math.max(0, rawMinY - basePad * 0.35);
        maxY = rawMaxY + basePad;
      }
    } else {
      const fallbackPad = Math.max(Math.abs(rawMaxY || 0) * 0.03, 1);
      const yPad = range > 0 ? Math.max(range * 0.18, fallbackPad) : fallbackPad;
      const candidateMin = rawMinY - yPad;
      const nearZero = rawMinY <= yPad * 1.35;
      minY = opts.minY !== undefined ? opts.minY : (nearZero ? 0 : Math.max(0, candidateMin));
      maxY = opts.maxY !== undefined ? opts.maxY : (rawMaxY + yPad);
    }
  }

  if (opts.allowNegative && minY > 0) minY = 0;
  if (!opts.allowNegative && !opts.smartScale) minY = Math.max(0, minY);
  if (maxY === minY) {
    if (maxY === 0) maxY = 1;
    else {
      const padAmt = Math.max(Math.abs(maxY) * 0.05, 1);
      minY = opts.smartScale ? Math.max(opts.allowNegative ? minY - padAmt : 0, minY - padAmt) : Math.min(0, minY);
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

  const tooltipMarkup = (x, y, lines = []) => {
    const safeLines = lines.map((line) => escapeHtml(String(line))).filter(Boolean);
    if (!safeLines.length) return '';
    const maxChars = Math.max(...safeLines.map((line) => line.length), 10);
    const boxW = Math.max(126, Math.min(254, maxChars * 7.1 + 28));
    const boxH = 18 + (safeLines.length * 18);
    const clampedX = Math.max(pad.left + boxW / 2, Math.min(width - pad.right - boxW / 2, x));
    const boxX = clampedX - boxW / 2;
    const desiredY = y - (boxH + 18);
    const boxY = desiredY < pad.top + 4 ? y + 18 : desiredY;
    const pointerUp = desiredY >= pad.top + 4;
    const pointerX = Math.max(boxX + 16, Math.min(boxX + boxW - 16, x));
    const lineMarkup = safeLines.map((line, idx) => {
      const cls = idx === 0 ? 'chart-tooltip-date' : idx === 1 ? 'chart-tooltip-value' : 'chart-tooltip-detail';
      const yy = boxY + 18 + (idx * 18);
      return `<text x="${clampedX.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="middle" class="${cls}">${line}</text>`;
    }).join('');
    return `
      <g class="chart-tooltip">
        <rect x="${boxX.toFixed(1)}" y="${boxY.toFixed(1)}" width="${boxW.toFixed(1)}" height="${boxH}" rx="12" ry="12" class="chart-tooltip-box" />
        <path d="M ${pointerX - 7} ${pointerUp ? boxY + boxH - 1 : boxY + 1} L ${pointerX} ${pointerUp ? boxY + boxH + 8 : boxY - 8} L ${pointerX + 7} ${pointerUp ? boxY + boxH - 1 : boxY + 1} Z" class="chart-tooltip-pointer" />
        ${lineMarkup}
      </g>`;
  };

  if (opts.type === 'bar') {
    const step = plotW / Math.max(points.length, 1);
    const barW = Math.min(72, Math.max(24, step * 0.52));
    const bars = points.map((p, i) => {
      const centerX = pad.left + (step * i) + (step / 2);
      const baseY = zeroY === null ? yScale(minY) : zeroY;
      const y = yScale(p.y);
      const x = centerX - barW / 2;
      const h = Math.max(1, Math.abs(baseY - y));
      const tooltipLines = opts.barTooltip ? opts.barTooltip(p) : [p.label, fmtMoney(Math.round(p.y * 100))];
      return `
        <g class="chart-bar-group">
          <rect x="${x.toFixed(1)}" y="${Math.min(y, baseY).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" class="chart-bar ${p.y < 0 ? 'negative' : 'positive'}" />
          <rect x="${(x - 6).toFixed(1)}" y="${Math.min(y, baseY).toFixed(1)}" width="${(barW + 12).toFixed(1)}" height="${h.toFixed(1)}" class="chart-hit-bar" />
          ${tooltipMarkup(centerX, Math.min(y, baseY), tooltipLines)}
          <text x="${centerX.toFixed(1)}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeHtml(p.label)}</text>
        </g>`;
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
    linePoints = [{ ...single, x: single.x - 1 }, single, { ...single, x: single.x + 1 }];
  }
  const lineMinX = Math.min(...linePoints.map((p) => p.x));
  const lineMaxX = Math.max(...linePoints.map((p) => p.x));
  const xScale = (x) => pad.left + ((x - lineMinX) / (lineMaxX - lineMinX)) * plotW;
  const line = linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L ${xScale(linePoints[linePoints.length - 1].x).toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${xScale(linePoints[0].x).toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;
  const xLabels = [linePoints[0], linePoints[Math.floor((linePoints.length - 1) / 2)], linePoints[linePoints.length - 1]]
    .filter((v, i, arr) => arr.findIndex((x) => x.label === v.label) === i)
    .map((p) => `<text x="${xScale(p.x)}" y="${height - 10}" text-anchor="middle" class="chart-label">${escapeHtml(p.label)}</text>`).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Chart">
    ${yTickMarkup}
    ${zeroY !== null ? `<line x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" class="chart-zero" />` : ''}
    <path d="${area}" class="chart-area" /><path d="${line}" class="chart-line" />
    ${linePoints.map((p) => {
      const tooltipLines = opts.pointTooltip ? opts.pointTooltip(p) : [p.label, fmtMoney(Math.round(p.y * 100))];
      const marker = p.marker || null;
      const markerCx = xScale(p.x);
      const markerCy = yScale(p.y);
      return `<g class="chart-point ${marker ? `has-marker marker-${marker.kind}` : ''}">
        ${marker ? `<circle cx="${markerCx}" cy="${markerCy}" r="6.5" class="chart-event-ring" /><circle cx="${markerCx}" cy="${markerCy}" r="2.35" class="chart-event-core" />` : ''}
        <circle cx="${markerCx}" cy="${markerCy}" r="3.5" class="chart-dot" />
        <circle cx="${markerCx}" cy="${markerCy}" r="11" class="chart-hit" />
        ${tooltipMarkup(markerCx, markerCy, tooltipLines)}
      </g>`;
    }).join('')}
    ${xLabels}
  </svg>`;
}

function computeTimeViews(rows, dateKey, valueKey) {
  const normalized = (rows || [])
    .filter((r) => r?.[dateKey] && r?.[valueKey] !== null && r?.[valueKey] !== undefined)
    .map((r) => ({ ...r, ts: new Date(`${r[dateKey]}T00:00:00`).getTime(), [valueKey]: Math.max(0, Number(r[valueKey]) || 0) }))
    .sort((a, b) => a.ts - b.ts);
  const latest = normalized[normalized.length - 1];
  const currentYear = latest ? Number(String(latest[dateKey]).slice(0, 4)) : todayYear();
  const currentYearRows = normalized.filter((r) => Number(String(r[dateKey]).slice(0, 4)) === currentYear);
  const yearStartTs = currentYearRows[0]?.ts ?? null;
  const monthlyCutoff = latest ? latest.ts - (30 * 24 * 60 * 60 * 1000) : null;
  const yearlyCutoff = latest ? latest.ts - (52 * 7 * 24 * 60 * 60 * 1000) : null;
  return {
    yearly: normalized.filter((r) => latest ? r.ts >= yearlyCutoff : true),
    monthly: normalized.filter((r) => latest ? r.ts >= monthlyCutoff : true),
    ytd: normalized.filter((r) => yearStartTs ? r.ts >= yearStartTs : false),
    all: normalized
  };
}

function computeBalanceViews(balanceHistory) {
  return computeTimeViews(balanceHistory, 'as_of_date', 'balance_cents');
}

function computeNavViews(navHistory) {
  return computeTimeViews(navHistory, 'as_of_date', 'nav_per_share_cents');
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

function renderPublicNavSection(container, landing) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <h2>NAV / Share History</h2>
        <div class="subtle">Major fund events appear on the chart when available.</div>
      </div>
      <div class="toggle-group" id="publicNavToggles">
        <button class="toggle active" data-view="yearly">1Y</button>
        <button class="toggle" data-view="ytd">YTD</button>
        <button class="toggle" data-view="all">All-Time</button>
      </div>
    </div>
    <div class="stats four compact-stats balance-stats" id="publicNavStats"></div>
    <div class="chart-wrap" id="publicNavChart"></div>`;
  container.appendChild(card);
  const chartEl = card.querySelector('#publicNavChart');
  const statsEl = card.querySelector('#publicNavStats');
  const labelMap = { yearly: 'Last 52 Weeks', ytd: 'YTD', all: 'All-Time' };
  const views = computeNavViews(landing.navHistory || []);
  const eventMap = new Map();
  (landing.navEvents || []).forEach((ev) => {
    if (!ev?.event_date) return;
    const existing = eventMap.get(ev.event_date) || [];
    existing.push(ev);
    eventMap.set(ev.event_date, existing);
  });

  function draw(viewKey) {
    const rows = views[viewKey] || [];
    if (!rows.length) {
      chartEl.innerHTML = '<div class="empty-state">NAV / share history will appear here once entries are added.</div>';
      statsEl.innerHTML = '<div class="stat"><div class="label">Range</div><div class="value">—</div></div><div class="stat"><div class="label">Start</div><div class="value">—</div></div><div class="stat"><div class="label">Latest</div><div class="value">—</div></div><div class="stat"><div class="label">Change</div><div class="value">—</div></div>';
      return;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const delta = last.nav_per_share_cents - first.nav_per_share_cents;
    const pct = first.nav_per_share_cents > 0 ? (delta / first.nav_per_share_cents) * 100 : null;
    const tone = pct === null ? 'neutral' : delta >= 0 ? 'pos' : 'neg';
    statsEl.innerHTML = `
      <div class="stat"><div class="label">Range</div><div class="value small-value">${labelMap[viewKey]}</div><div class="subtle">${rows.length} point${rows.length === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Start NAV</div><div class="value small-value">${fmtMoney(first.nav_per_share_cents)}</div><div class="subtle">${first.as_of_date}</div></div>
      <div class="stat"><div class="label">Current NAV</div><div class="value small-value">${fmtMoney(last.nav_per_share_cents)}</div><div class="subtle">${last.as_of_date}</div></div>
      <div class="stat change-stat"><div class="label">Change</div><div class="change-readout"><div class="change-amount ${tone}">${fmtMoney(delta)}</div><div class="change-percent ${tone}">${pct === null ? 'Percent change unavailable' : fmtPct(pct)}</div></div></div>`;
    const plotted = rows.map((r) => {
      const matching = eventMap.get(r.as_of_date) || [];
      const marker = matching.length ? { kind: 'deposit', lines: [formatDatePretty(r.as_of_date), fmtMoney(r.nav_per_share_cents), ...matching.flatMap((ev) => [ev.title, ev.notes || '']).filter(Boolean).slice(0, 4)] } : null;
      const tooltipLines = [formatDatePretty(r.as_of_date), fmtMoney(r.nav_per_share_cents), ...matching.flatMap((ev) => [ev.title, ev.notes || '']).filter(Boolean).slice(0, 4)];
      return { x: r.ts, y: r.nav_per_share_cents / 100, label: r.as_of_date, marker, tooltipLines };
    });
    chartEl.innerHTML = buildChartSvg(plotted, { smartScale: true, pointTooltip: (p) => p.tooltipLines });
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

function renderLogin() {
  app.innerHTML = '';
  const acct = document.getElementById('siteHeaderAcct');
  if (acct) acct.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'public-shell';
  shell.innerHTML = `
    <div class="public-left">
      <div class="card hero-card">
        <div class="eyebrow">The Benjamin Fund</div>
        <h1>Investor Experience</h1>
        <div class="subtle hero-copy">A secure dashboard for investor balances, transactions, and account reporting.</div>
        <div class="stats three compact-stats hero-stats" id="publicHeroStats">
          <div class="stat"><div class="label">Current NAV / Share</div><div class="value">—</div></div>
          <div class="stat"><div class="label">Last Updated</div><div class="value small-value">—</div></div>
          <div class="stat"><div class="label">Portal Access</div><div class="value small-value">Secure Login</div></div>
        </div>
      </div>
      <div id="publicNavMount"></div>
    </div>
    <div class="public-right">
      <div class="card login-card public-login-card">
        <h2>Investor Login</h2>
        <div class="subtle">Sign in to view account information.</div>
        <div class="stack-sm top-gap">
          <input id="email" type="email" placeholder="Email" />
          <input id="password" type="password" placeholder="Password" />
          <button id="login">Login</button>
        </div>
      </div>
    </div>`;
  app.appendChild(shell);
  shell.querySelector('#login').onclick = async () => {
    const email = shell.querySelector('#email').value.trim();
    const password = shell.querySelector('#password').value.trim();
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
  api('/api/public-landing').then((landing) => {
    const stats = shell.querySelector('#publicHeroStats');
    stats.innerHTML = `
      <div class="stat"><div class="label">Current NAV / Share</div><div class="value">${landing.current_nav_per_share_cents === null || landing.current_nav_per_share_cents === undefined ? '—' : fmtMoney(landing.current_nav_per_share_cents)}</div></div>
      <div class="stat"><div class="label">Last Updated</div><div class="value small-value">${escapeHtml(landing.last_updated || '—')}</div></div>
      <div class="stat"><div class="label">Portal Access</div><div class="value small-value">Secure Login</div></div>`;
    renderPublicNavSection(shell.querySelector('#publicNavMount'), landing);
  }).catch(() => {});
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
    <div class="stats four compact-stats balance-stats" id="balanceStats"></div>
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
      statsEl.innerHTML = '<div class="stat"><div class="label">Range</div><div class="value">—</div></div><div class="stat"><div class="label">Start</div><div class="value">—</div></div><div class="stat"><div class="label">Latest</div><div class="value">—</div></div><div class="stat"><div class="label">Change</div><div class="value">—</div><div class="subtle">&nbsp;</div></div>';
      return;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const delta = last.balance_cents - first.balance_cents;
    const pct = first.balance_cents > 0 ? (delta / first.balance_cents) * 100 : null;
    const tone = pct === null ? 'neutral' : delta >= 0 ? 'pos' : 'neg';
    statsEl.innerHTML = `
      <div class="stat"><div class="label">Range</div><div class="value small-value">${labelMap[viewKey]}</div><div class="subtle">${rows.length} point${rows.length === 1 ? '' : 's'}</div></div>
      <div class="stat"><div class="label">Start</div><div class="value small-value">${fmtMoney(first.balance_cents)}</div><div class="subtle">${first.as_of_date}</div></div>
      <div class="stat"><div class="label">Latest</div><div class="value small-value">${fmtMoney(last.balance_cents)}</div><div class="subtle">${last.as_of_date}</div></div>
      <div class="stat change-stat"><div class="label">Change</div><div class="change-readout"><div class="change-amount ${tone}">${fmtMoney(delta)}</div><div class="change-percent ${tone}">${pct === null ? 'Percent change unavailable' : fmtPct(pct)}</div></div></div>`;
    const txMap = summarizeTransactionsByDate(bundle.transactions || []);
    const plotted = rows.map((r) => {
      const markerSummary = txMap.get(r.as_of_date);
      const marker = buildTransactionMarker(r.as_of_date, markerSummary);
      const lines = [formatDatePretty(r.as_of_date), fmtMoney(r.balance_cents)];
      if (markerSummary) {
        if (markerSummary.deposit_cents > 0) lines.push(`Deposit ${fmtMoney(markerSummary.deposit_cents)}`);
        if (markerSummary.redemption_cents > 0) lines.push(`Redemption ${fmtMoney(markerSummary.redemption_cents)}`);
        markerSummary.items.slice(0, 2).forEach((item) => {
          if (item.notes) lines.push(item.notes);
        });
      }
      return { x: r.ts, y: r.balance_cents / 100, label: r.as_of_date, marker, tooltipLines: lines };
    });
    chartEl.innerHTML = buildChartSvg(
      plotted,
      {
        smartScale: true,
        pointTooltip: (p) => p.tooltipLines
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
    <div class="chart-wrap">${buildChartSvg(rows.map((r, i) => ({ x: i + 1, y: (Number(r.net_deposits_cents) || 0) / 100, label: String(r.year) })), { type: 'bar', allowNegative: true, smartScale: true, barTooltip: (p) => [p.label, fmtMoney(Math.round(p.y * 100))] })}</div>`;
  container.appendChild(card);
}

function renderTransactionsSection(container, bundle) {
  const allRows = (bundle.transactions || []).slice();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Deposits and Withdrawals</h2>
        <div class="subtle">Filter by type or year, and sort by date or amount.</div>
      </div>
      <div class="toggle-group transaction-toolbar">
        <select id="txFilterType">
          <option value="all">All Types</option>
          <option value="deposit">Deposits</option>
          <option value="redemption">Redemptions</option>
        </select>
        <select id="txFilterYear"><option value="all">All Years</option></select>
        <select id="txSort">
          <option value="date_desc">Newest First</option>
          <option value="date_asc">Oldest First</option>
          <option value="amount_desc">Amount High to Low</option>
          <option value="amount_asc">Amount Low to High</option>
        </select>
      </div>
    </div>
    <div class="table-wrap">
      <table class="table mono">
        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>NAV / Share</th><th>Notes</th></tr></thead>
        <tbody id="txTableBody"></tbody>
      </table>
    </div>`;
  container.appendChild(card);
  const yearSelect = card.querySelector('#txFilterYear');
  uniqueYears(allRows, 'tx_date').reverse().forEach((year) => {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    yearSelect.appendChild(opt);
  });
  const tbody = card.querySelector('#txTableBody');

  function draw() {
    const filterType = card.querySelector('#txFilterType').value;
    const filterYear = card.querySelector('#txFilterYear').value;
    const sortKey = card.querySelector('#txSort').value;
    let rows = allRows.filter((tx) => filterType === 'all' ? true : tx.tx_type === filterType);
    rows = rows.filter((tx) => filterYear === 'all' ? true : String(tx.tx_date || '').startsWith(filterYear));
    rows.sort((a, b) => {
      if (sortKey === 'date_asc') return String(a.tx_date).localeCompare(String(b.tx_date)) || Number(a.amount_cents || 0) - Number(b.amount_cents || 0);
      if (sortKey === 'amount_desc') return Number(b.amount_cents || 0) - Number(a.amount_cents || 0) || String(b.tx_date).localeCompare(String(a.tx_date));
      if (sortKey === 'amount_asc') return Number(a.amount_cents || 0) - Number(b.amount_cents || 0) || String(b.tx_date).localeCompare(String(a.tx_date));
      return String(b.tx_date).localeCompare(String(a.tx_date)) || Number(b.amount_cents || 0) - Number(a.amount_cents || 0);
    });
    tbody.innerHTML = rows.length ? rows.map((tx) => `
      <tr>
        <td>${escapeHtml(tx.tx_date)}</td>
        <td>${escapeHtml(tx.tx_type === 'redemption' ? 'Redemption' : 'Deposit')}</td>
        <td>${fmtMoney(tx.amount_cents)}</td>
        <td>${tx.nav_per_share_cents === null || tx.nav_per_share_cents === undefined ? '—' : fmtMoney(tx.nav_per_share_cents)}</td>
        <td>${escapeHtml(tx.notes || '')}</td>
      </tr>`).join('') : '<tr><td colspan="5">No transactions match the selected filters.</td></tr>';
  }

  card.querySelectorAll('select').forEach((el) => { el.onchange = draw; });
  draw();
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
          <input id="newLabel" type="text" placeholder="Custom label (optional)" />
          <input id="newEmail" type="email" placeholder="Investor email" />
          <input id="newPass" type="text" placeholder="Optional password" />
          <button id="createUser">Add Investor</button>
          <div class="subtle">Leave password blank to generate a temporary password.</div>
        </div>
      </div>
      <div class="card inner-card">
        <h3>Investors</h3>
        <select id="investorSort">
          <option value="label_asc">Sort: A–Z</option>
          <option value="label_desc">Sort: Z–A</option>
          <option value="nav_desc">Sort: Current NAV</option>
          <option value="invested_desc">Sort: Total Invested</option>
          <option value="return_desc">Sort: Return %</option>
        </select>
        <div class="investor-list top-gap" id="investorList"></div>
      </div>
      <div class="card inner-card">
        <h3>Settings</h3>
        <div class="stack-sm">
          <input id="lastUpdated" placeholder="Last Updated (YYYY-MM-DD)" />
          <button id="saveLastUpdated">Save</button>
          <button id="downloadBackup" class="ghost-btn">Download Backup</button>
        </div>
      </div>`;

    const sortEl = sidebar.querySelector('#investorSort');
    sortEl.value = state.adminSort;
    sortEl.onchange = () => { state.adminSort = sortEl.value; refreshSidebar(state.adminSelectedUserId); };
    const list = sidebar.querySelector('#investorList');
    sortAdminUsers(users, state.adminSort).forEach((u) => {
      const btn = document.createElement('button');
      btn.className = `investor-item ${u.id === state.adminSelectedUserId ? 'active' : ''}`;
      const label = getInvestorLabel(u);
      btn.innerHTML = `<span class="investor-main"><strong>${escapeHtml(label)}</strong><span class="subtle investor-sub">${escapeHtml(u.email)}</span></span><span class="pill">${u.role}</span>`;
      btn.onclick = () => { state.adminSelectedUserId = u.id; refreshSidebar(u.id); loadDetail(u.id); };
      list.appendChild(btn);
    });

    sidebar.querySelector('#createUser').onclick = async () => {
      const email = sidebar.querySelector('#newEmail').value.trim();
      const password = sidebar.querySelector('#newPass').value.trim();
      const label = sidebar.querySelector('#newLabel').value.trim();
      if (!email) return toast('Email required.', false);
      try {
        const created = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ email, password: password || undefined, display_label: label || undefined }) });
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
    sidebar.querySelector('#downloadBackup').onclick = async () => {
      try {
        const res = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${state.token}` } });
        if (!res.ok) throw new Error('Backup failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'benjamin-fund-backup.sqlite';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (e) {
        toast(e.message || 'Backup failed.', false);
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
            <h3>${escapeHtml(getInvestorLabel(bundle.user))}</h3>
            <div class="subtle investor-sub">${escapeHtml(bundle.user.email)}</div>
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
      renderAdminFundNavSection(detail);
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
          <label>Display Label</label>
          <input id="displayLabel" value="${escapeHtml(bundle.user.display_label || '')}" placeholder="Custom investor label" />
        </div>
        <div></div>
      </div>
      <div class="stats three compact-stats top-gap">
        <div class="stat"><div class="label">Total Invested</div><div class="value small-value">${fmtMoney(bundle.user.deposit_cents)}</div><div class="subtle">Auto-calculated from transactions by year</div></div>
        <div class="stat"><div class="label">Current NAV</div><div class="value small-value">${fmtMoney(bundle.user.balance_cents)}</div><div class="subtle">Latest saved balance entry</div></div>
        <div class="stat"><div class="label">Calculation Mode</div><div class="value small-value">Automatic</div><div class="subtle">Transactions + balance history drive dashboard totals</div></div>
      </div>
      <div class="subtle top-gap">Only the display label is edited here. Total Invested and Current NAV now update automatically from the investor ledger and balance history.</div>
      <div class="top-gap"><button id="saveOverview">Save Label</button></div>`;
    parent.appendChild(sec);
    sec.querySelector('#saveOverview').onclick = async () => {
      try {
        await api(`/api/admin/users/${bundle.user.id}/summary`, {
          method: 'PATCH',
          body: JSON.stringify({
            display_label: sec.querySelector('#displayLabel').value.trim()
          })
        });
        toast('Label saved.');
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
      <div class="subtle">These values are now auto-calculated from the investor transaction ledger. Deposits add to the yearly total and redemptions subtract from it.</div>
      <div class="table-wrap"><table class="table mono"><thead><tr><th>Year</th><th>Net Deposits (USD)</th></tr></thead><tbody id="yearlyBody"></tbody></table></div>`;
    parent.appendChild(sec);
    const tbody = sec.querySelector('#yearlyBody');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="subtle">No transactions entered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(String(r.year))}</td>
        <td>${escapeHtml(fmtMoney(r.net_deposits_cents))}</td>
      </tr>`).join('');
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
          <div class="subtle">Save one year at a time. Dates stay manual, but new rows can smart-prefill from your existing pattern.</div>
        </div>
        <select id="balanceYearSelect">${years.map((y) => `<option value="${y}" ${String(y) === defaultYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div class="table-wrap"><table class="table mono"><thead><tr><th>Date</th><th>Balance (USD)</th><th></th></tr></thead><tbody id="balanceBody"></tbody></table></div>
      <div class="subtle top-gap" id="balanceValidationHint">Each row must have a unique date inside the selected year.</div>
      <div class="row wrap-row top-gap"><button id="addBalanceRow">Add Balance Row</button><button id="addTenBalanceRows" class="ghost-btn">Add 10 Rows</button><button id="saveBalanceRows">Save Selected Year</button></div>
      <details class="bulk-box top-gap"><summary>Bulk Paste Weekly Balances</summary><div class="subtle top-gap">Paste two columns from a spreadsheet: date and balance. Tabs, commas, or multiple spaces all work.</div><textarea id="balanceBulkPaste" rows="7" placeholder="2025-01-10    10250
2025-01-24    10410"></textarea><div class="row wrap-row top-gap"><button id="applyBalancePaste" class="ghost-btn">Append Parsed Rows</button></div></details>`;
    parent.appendChild(sec);
    const tbody = sec.querySelector('#balanceBody');
    const yearSelect = sec.querySelector('#balanceYearSelect');
    const addButton = sec.querySelector('#addBalanceRow');
    const addTenButton = sec.querySelector('#addTenBalanceRows');
    const saveButton = sec.querySelector('#saveBalanceRows');

    const inferNextDate = () => {
      const dates = [...tbody.querySelectorAll('.date-input')].map((input) => input.value).filter(Boolean);
      if (!dates.length) return '';
      const last = dates[dates.length - 1];
      if (dates.length >= 2) {
        const prev = parseISODate(dates[dates.length - 2]);
        const curr = parseISODate(last);
        if (prev && curr) {
          const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
          if (diff > 0 && diff <= 31) return addDaysIso(last, diff);
        }
      }
      return addDaysIso(last, 7);
    };

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

    addButton.onclick = () => addRow(inferNextDate(), '');
    addTenButton.onclick = () => {
      let nextDate = inferNextDate();
      for (let i = 0; i < 10; i += 1) {
        addRow(nextDate, '');
        nextDate = nextDate ? addDaysIso(nextDate, 7) : '';
      }
    };
    drawYear();
    yearSelect.onchange = drawYear;
    sec.querySelector('#applyBalancePaste').onclick = () => {
      const raw = sec.querySelector('#balanceBulkPaste').value.trim();
      if (!raw) return toast('Paste some rows first.', false);
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let added = 0;
      lines.forEach((line) => {
        const parts = line.split(/\t|,|\s{2,}/).map((part) => part.trim()).filter(Boolean);
        if (parts.length < 2) return;
        const [date, value] = parts;
        addRow(date, value.replace(/[$,]/g, ''));
        added += 1;
      });
      toast(added ? `Added ${added} row${added === 1 ? '' : 's'} from paste.` : 'No valid rows were detected.', !!added);
      if (added) sec.querySelector('#balanceBulkPaste').value = '';
    };
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


  function renderAdminFundNavSection(parent) {
    const card = document.createElement('div');
    card.className = 'card inner-card';
    card.innerHTML = `<h3>Fund NAV / Share</h3><div class="subtle">Manage the public NAV/share chart and optional major event callouts shown on the landing page.</div><div id="fundNavAdminMount" class="top-gap"><div class="subtle">Loading fund chart data…</div></div>`;
    parent.appendChild(card);
    const mount = card.querySelector('#fundNavAdminMount');
    api('/api/admin/fund-nav').then((bundle) => {
      const navRows = (bundle.navHistory || []).slice().sort((a, b) => String(a.as_of_date).localeCompare(String(b.as_of_date)));
      const eventRows = (bundle.navEvents || []).slice().sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
      mount.innerHTML = `
        <div class="grid two-col">
          <div>
            <div class="subtle">NAV / Share History</div>
            <div class="table-wrap top-gap"><table class="table mono"><thead><tr><th>Date</th><th>NAV / Share (USD)</th><th></th></tr></thead><tbody id="navHistoryBody"></tbody></table></div>
            <div class="row wrap-row top-gap"><button id="addNavRow">Add Row</button><button id="saveNavRows">Save NAV History</button></div>
            <details class="bulk-box top-gap"><summary>Bulk Paste NAV / Share History</summary><div class="subtle top-gap">Paste two columns from a spreadsheet: date and NAV/share. Tabs, commas, or multiple spaces all work.</div><textarea id="navBulkPaste" rows="7" placeholder="2025-01-10    12.50
2025-01-24    12.61"></textarea><div class="row wrap-row top-gap"><button id="applyNavPaste" class="ghost-btn">Append Parsed Rows</button></div></details>
          </div>
          <div>
            <div class="subtle">Major Fund Events</div>
            <div class="table-wrap top-gap"><table class="table mono"><thead><tr><th>Date</th><th>Title</th><th>Notes</th><th></th></tr></thead><tbody id="navEventBody"></tbody></table></div>
            <div class="row wrap-row top-gap"><button id="addNavEventRow" class="ghost-btn">Add Event</button><button id="saveNavEventRows">Save Events</button></div>
          </div>
        </div>`;
      const navBody = mount.querySelector('#navHistoryBody');
      const eventBody = mount.querySelector('#navEventBody');
      const addNavRow = (row = {}) => {
        const tr = makeTableRow([
          `<td><input class="date-input" type="date" value="${escapeHtml(row.as_of_date || '')}" /></td>`,
          `<td><input class="money-input nav-share-input" value="${escapeHtml(centsToInput(row.nav_per_share_cents))}" placeholder="0.00" /></td>`,
          `<td><button class="ghost-btn delete-row">Remove</button></td>`
        ]);
        tr.querySelector('.delete-row').onclick = () => tr.remove();
        navBody.appendChild(tr);
      };
      const addEventRow = (row = {}) => {
        const tr = makeTableRow([
          `<td><input class="date-input" type="date" value="${escapeHtml(row.event_date || '')}" /></td>`,
          `<td><input class="event-title-input" value="${escapeHtml(row.title || '')}" placeholder="Event title" /></td>`,
          `<td><input class="event-notes-input" value="${escapeHtml(row.notes || '')}" placeholder="Optional note" /></td>`,
          `<td><button class="ghost-btn delete-row">Remove</button></td>`
        ]);
        tr.querySelector('.delete-row').onclick = () => tr.remove();
        eventBody.appendChild(tr);
      };
      navRows.forEach(addNavRow);
      eventRows.forEach(addEventRow);
      if (!navRows.length) addNavRow({});
      if (!eventRows.length) addEventRow({});
      mount.querySelector('#addNavRow').onclick = () => addNavRow({});
      mount.querySelector('#addNavEventRow').onclick = () => addEventRow({});
                  mount.querySelector('#applyNavPaste').onclick = () => {
        const raw = mount.querySelector('#navBulkPaste').value || '';
        const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return toast('Paste at least one NAV row first.', false);
        let appended = 0;
        const bad = [];
        lines.forEach((line, idx) => {
          const clean = line.replace(/\$+/g, '').trim();
          const m = clean.match(/^(\d{4}-\d{2}-\d{2})[\t ]+(.+)$/);
          if (!m) {
            bad.push(idx + 1);
            return;
          }
          const date = m[1];
          const valueRaw = m[2].trim().replace(/,/g, '');
          const cents = toUsdInputCents(valueRaw);
          if (cents === null) {
            bad.push(idx + 1);
            return;
          }
          addNavRow({ as_of_date: date, nav_per_share_cents: cents });
          appended += 1;
        });
        if (!appended) return toast('No NAV rows could be parsed from the pasted data.', false);
        mount.querySelector('#navBulkPaste').value = '';
        toast(`Appended ${appended} NAV row${appended === 1 ? '' : 's'}${bad.length ? ` (${bad.length} skipped)` : ''}.`, bad.length === 0);
      };

      mount.querySelector('#saveNavRows').onclick = async () => {
        const payload = [...navBody.querySelectorAll('tr')].map((tr) => ({
          as_of_date: tr.querySelector('.date-input').value,
          nav_per_share_cents: toUsdInputCents(tr.querySelector('.nav-share-input').value)
        })).filter((row) => row.as_of_date && row.nav_per_share_cents !== null);
        try {
          await api('/api/admin/fund-nav/history', { method: 'PUT', body: JSON.stringify({ rows: payload }) });
          toast('Fund NAV history saved.');
        } catch (e) {
          toast(e.message || 'Save failed.', false);
        }
      };
      mount.querySelector('#saveNavEventRows').onclick = async () => {
        const payload = [...eventBody.querySelectorAll('tr')].map((tr) => ({
          event_date: tr.querySelector('.date-input').value,
          title: tr.querySelector('.event-title-input').value.trim(),
          notes: tr.querySelector('.event-notes-input').value.trim()
        })).filter((row) => row.event_date && row.title);
        try {
          await api('/api/admin/fund-nav/events', { method: 'PUT', body: JSON.stringify({ rows: payload }) });
          toast('Fund chart events saved.');
        } catch (e) {
          toast(e.message || 'Save failed.', false);
        }
      };
    }).catch((e) => {
      mount.innerHTML = `<div class="subtle">${escapeHtml(e.message || 'Failed to load fund chart settings.')}</div>`;
    });
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
