
async function resolveChromiumExecutablePath() {
  const explicitPaths = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ];

  for (const p of explicitPaths) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }

  try {
    const bundledPath = await chromium.executablePath();
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath;
  } catch (_) {}

  throw new Error(
    'No Chromium executable found. Set CHROME_PATH in your .env file to your local Chrome binary ' +
    '(e.g. C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe on Windows).'
  );
}
// Update 4-3-26: New function for automatically generating monthly statements for all investors
// Generates a PDF statement for each investor for the previous calendar month (can change the date range if needed)
// Uses Puppeteer to render the HTML to a PDF
// Uses the data from the database to generate the statements

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { fileURLToPath } from 'url';

function sanitizeFileStem(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Embed logo as a data URI so Puppeteer can render it without relying on a web server.
let logoDataUri = '';
try {
  const logoPath = path.join(__dirname, 'public', 'logo.png');
  const ext = path.extname(logoPath).slice(1).toLowerCase() || 'png';
  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  const buf = fs.readFileSync(logoPath);
  logoDataUri = `data:${mime};base64,${buf.toString('base64')}`;
} catch {
  // If logo isn't available, statements will render without it.
  logoDataUri = '';
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtMoney = (cents) => {
  if (cents === null || cents === undefined || Number.isNaN(Number(cents))) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(cents) / 100);
};

const fmtDatePretty = (isoDate) => {
  if (!isoDate) return '—';
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtNum = (v, digits = 3) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

function getYmdParts(isoDate) {
  // isoDate expected "YYYY-MM-DD"
  const [y, m, d] = String(isoDate || '').split('-').map((x) => Number(x));
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function buildStatementHtml({
  investorLabel,
  investorEmail,
  investorId,
  address,
  startDate,
  endDate,
  openingBalanceCents,
  depositTotalCents,
  redemptionTotalCents,
  closingBalanceCents,
  transactions,
  statementTitle = 'Monthly Statement'
}) {
  const tone = depositTotalCents - redemptionTotalCents >= 0 ? 'positive' : 'negative';
  const netCents = (transactions || []).reduce((sum, tx) => {
    const sign = ['redemption','performance_fee','redemption_fee','other_fee','tax'].includes(tx.tx_type) ? -1 : 1;
    return sum + sign * Math.abs(Number(tx.amount_cents || 0));
  }, 0);
  const generatedOn = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const TX_TYPE_LABELS = {
    deposit: 'Deposit', redemption: 'Redemption', performance_fee: 'Performance Fee',
    redemption_fee: 'Redemption Fee', management_credit: 'Management Credit',
    extraordinary_dividend: 'Extraordinary Dividend', other_fee: 'Other Fee',
    other_credit: 'Other Credit', tax: 'Tax',
  };
  const NEGATIVE_TX_TYPES = new Set(['redemption','performance_fee','redemption_fee','other_fee','tax']);

  let totalUnits = 0;
  let weightedPriceNumerator = 0;
  const rowsHtml = (transactions || []).map((tx) => {
    const typeLabel = TX_TYPE_LABELS[tx.tx_type] || tx.tx_type;
    const isNegative = NEGATIVE_TX_TYPES.has(tx.tx_type);
    const amountAbsCents = Math.abs(Number(tx.amount_cents || 0));
    const signedAmountCents = isNegative ? -amountAbsCents : amountAbsCents;
    const amountLabel = fmtMoney(signedAmountCents);
    const navPerShareCents = tx.nav_per_share_cents === null || tx.nav_per_share_cents === undefined
      ? null
      : Number(tx.nav_per_share_cents || 0);
    const navLabel = navPerShareCents === null ? '—' : fmtMoney(navPerShareCents);
    const quantity = navPerShareCents && navPerShareCents > 0 ? amountAbsCents / navPerShareCents : null;
    const signedQty = quantity === null ? null : (isNegative ? -quantity : quantity);
    if (tx.tx_type === 'deposit' && quantity !== null) {
      totalUnits += quantity;
      weightedPriceNumerator += quantity * (navPerShareCents / 100);
    }

    const itemLabel = tx.notes || typeLabel;
    return `
      <tr>
        <td>${escapeHtml(tx.tx_date || '—')}</td>
        <td>${escapeHtml(typeLabel)}</td>
        <td class="item">${escapeHtml(itemLabel)}</td>
        <td class="num">${escapeHtml(fmtNum(signedQty, 3))}</td>
        <td class="num">${escapeHtml(navLabel)}</td>
        <td class="num ${signedAmountCents < 0 ? 'neg' : 'pos'}">${escapeHtml(amountLabel)}</td>
      </tr>`;
  }).join('');
  const weightedAvgPrice = totalUnits > 0 ? weightedPriceNumerator / totalUnits : null;
  const marketValueAndDividendsCents = closingBalanceCents - depositTotalCents + redemptionTotalCents;
  const byType = {};
  for (const tx of transactions || []) {
    const amt = Math.abs(Number(tx.amount_cents || 0));
    byType[tx.tx_type] = (byType[tx.tx_type] || 0) + amt;
  }
  const performanceFeesCents = byType.performance_fee || 0;
  const redemptionFeesCents = byType.redemption_fee || 0;
  const managementCreditsCents = byType.management_credit || 0;
  const extraordinaryDividendsCents = byType.extraordinary_dividend || 0;
  const otherFeesCents = byType.other_fee || 0;
  const otherCreditsCents = byType.other_credit || 0;
  const taxCents = byType.tax || 0;
  const netInvestmentsCents = depositTotalCents - redemptionTotalCents;
  const investmentRevenueCents = closingBalanceCents - openingBalanceCents - netInvestmentsCents;
  const totalCreditsCents =  managementCreditsCents + extraordinaryDividendsCents + otherCreditsCents;
  const totalFeesCents = performanceFeesCents + redemptionFeesCents + otherFeesCents;
  const subtotalCents = investmentRevenueCents + totalCreditsCents - totalFeesCents;
  const netGainCents = subtotalCents - taxCents;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          :root { --ink: #0b1220; --muted: #5a6578; --line: #d8deea; --soft: #f6f8fc; --pos: #0f766e; --neg: #dc2626; }
          body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; color: var(--ink); }
          .page { padding: 22px 24px 20px; }
          .top { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; border-bottom: 1px solid var(--line); padding-bottom: 10px; }
          .title { font-size: 24px; font-weight: 800; margin: 0 0 8px; }
          .kv { font-size: 12px; margin: 3px 0; }
          .kv b { display: inline-block; min-width: 88px; color: var(--muted); font-weight: 700; }
          .period { text-align: right; }
          .period .big { font-size: 15px; font-weight: 700; margin-top: 4px; }
          .period .small { color: var(--muted); font-size: 11px; line-height: 1.35; margin-top: 5px; }
          .grid2 { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
          .box { border: 1px solid var(--line); background: var(--soft); border-radius: 8px; padding: 10px 12px; }
          .label { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
          .value { font-size: 20px; font-weight: 800; }
          .summary-row { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
          .mini { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px; background: #fff; }
          .mini b { display: block; color: var(--muted); margin-bottom: 3px; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 700; padding: 8px 6px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); text-transform: uppercase; letter-spacing: .03em; }
          td { padding: 8px 6px; border-bottom: 1px solid var(--line); font-size: 12px; vertical-align: top; }
          td.num, th.num { text-align: right; white-space: nowrap; }
          td.item { max-width: 290px; }
          .pos { color: var(--pos); font-weight: 700; }
          .neg { color: var(--neg); font-weight: 700; }
          .section { margin-top: 12px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
          .section .head { background: var(--soft); font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 7px 10px; border-bottom: 1px solid var(--line); }
          .lines { padding: 8px 10px; }
          .line { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 4px 0; font-size: 12px; }
          .line .amt { font-variant-numeric: tabular-nums; }
          .line.bold { font-weight: 700; border-top: 1px solid var(--line); margin-top: 2px; padding-top: 7px; }
          .footer { margin-top: 10px; color: var(--muted); font-size: 10px; }
          .logo-wrap { text-align: center; padding-bottom: 14px; border-bottom: 1px solid var(--line); margin-bottom: 10px; }
          .logo-wrap img { height: 48px; width: auto; }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="logo-wrap">
            ${logoDataUri ? `<img src="${logoDataUri}" alt="The Benjamin Fund" />` : ''}
          </div>
          <div class="top" style="border-top: none;">
            <div class="left">
              <h1 class="title">${escapeHtml(statementTitle)}</h1>
              <div class="kv"><b>Investor</b>${escapeHtml(investorLabel || 'Investor')}</div>
              <div class="kv"><b>Investor ID</b>${escapeHtml(investorId || '—')}</div>
              <div class="kv"><b>Email</b>${escapeHtml(investorEmail || '—')}</div>
              <div class="kv"><b>Address</b><br>${escapeHtml(address || '—')}</div>
            </div>
            <div class="period">
              <div class="label">Period</div>
              <div class="big">${escapeHtml(fmtDatePretty(startDate))} - ${escapeHtml(fmtDatePretty(endDate))}</div>
              <div class="small">All values as of ${escapeHtml(generatedOn)}</div>
            </div>
          </div>

          <div class="grid2">
            <div class="box">
              <div class="label">Opening balance</div>
              <div class="value">${escapeHtml(fmtMoney(openingBalanceCents))}</div>
            </div>
            <div class="box">
              <div class="label">Closing balance</div>
              <div class="value">${escapeHtml(fmtMoney(closingBalanceCents))}</div>
            </div>
          </div>

          <div class="summary-row">
            <div class="mini"><b>Deposits</b>${escapeHtml(fmtMoney(depositTotalCents))}</div>
            <div class="mini"><b>Redemptions</b>${escapeHtml(fmtMoney(redemptionTotalCents))}</div>
            <div class="mini"><b>Net</b><span class="${tone === 'positive' ? 'pos' : 'neg'}">${escapeHtml(fmtMoney(netCents))}</span></div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width:84px;">Date</th>
                <th style="width:74px;">Type</th>
                <th>Item</th>
                <th class="num" style="width:86px;">Quantity</th>
                <th class="num" style="width:88px;">Price</th>
                <th class="num" style="width:92px;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan="6" style="padding:16px 8px; color:#5a6578;">No transactions during this period.</td></tr>`}
              <tr>
                <td colspan="3"><b>Total Investments</b></td>
                <td class="num">${escapeHtml(fmtNum(totalUnits, 3))}</td>
                <td class="num">${escapeHtml(weightedAvgPrice === null ? '—' : fmtMoney(Math.round(weightedAvgPrice * 100)))}</td>
                <td class="num"><b>${escapeHtml(fmtMoney(depositTotalCents))}</b></td>
              </tr>
              <tr>
                <td colspan="5">Market Value + Dividends</td>
                <td class="num">${escapeHtml(fmtMoney(marketValueAndDividendsCents))}</td>
              </tr>
            </tbody>
          </table>

          <div class="section">
            <div class="head">Investment Activity</div>
            <div class="lines">
              <div class="line"><div>Opening Balance</div><div class ="amt" style="font-weight: bold;">${escapeHtml(fmtMoney(openingBalanceCents))}</div></div>
              <div class="line"><div>Total Deposits</div><div class="amt pos">${escapeHtml(fmtMoney(depositTotalCents))}</div></div>
              <div class="line"><div>Total Redemptions</div><div class="amt ${redemptionTotalCents > 0 ? 'neg' : ''}">${escapeHtml(fmtMoney(-redemptionTotalCents))}</div></div>
              <div class="line"><div>Net Investments</div><div class="amt">${escapeHtml(fmtMoney(netInvestmentsCents))}</div></div>
              <div class="line"><div>Market Value</div><div class="amt">${escapeHtml(fmtMoney(closingBalanceCents))}</div></div>
              <div class="line bold"><div>Investment Revenue</div><div class="amt ${investmentRevenueCents < 0 ? 'neg' : 'pos'}">${escapeHtml(fmtMoney(investmentRevenueCents))}</div></div>
            </div>
          </div>

          <div class="section">
            <div class="head">Revenue Summary</div>
            <div class="lines">
              <div class="line"><div>Investment Revenue</div><div class="amt">${escapeHtml(fmtMoney(investmentRevenueCents))}</div></div>
              <div class="line"><div>Credits</div><div class="amt ${totalCreditsCents > 0 ? 'pos' : ''}">${escapeHtml(fmtMoney(totalCreditsCents))}</div></div>
              <div class="line"><div>Fees</div><div class="amt ${totalFeesCents > 0 ? 'neg' : ''}">${escapeHtml(fmtMoney(-totalFeesCents))}</div></div>
              <div class="line bold"><div>Subtotal</div><div class="amt">${escapeHtml(fmtMoney(subtotalCents))}</div></div>
              <div class="line"><div>Taxes</div><div class="amt ${taxCents > 0 ? 'neg' : ''}">${escapeHtml(fmtMoney(-taxCents))}</div></div>
              <div class="line bold"><div>Net Gain</div><div class="amt ${netGainCents < 0 ? 'neg' : 'pos'}">${escapeHtml(fmtMoney(netGainCents))}</div></div>
            </div>
          </div>

          <div class="footer">This statement is generated automatically from your investor ledger entries. Placeholder identity fields can be replaced when those data points become available.</div>
        </div>
      </body>
    </html>
  `;
}

async function renderHtmlToPdf(page, html, filePath) {
  // Reuse a single Puppeteer page for speed when generating multiple PDFs.
  // We render static HTML (no external navigation). Waiting for `networkidle0` can
  // hang in headless mode if any background requests never fully settle.
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.pdf({
    path: filePath,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' }
  });
}

async function generateMonthlyStatements({
  startDate,
  endDate,
  customFileName = null,
  frequency = 'monthly',
  statementMonth = null,
  statementYear = null,
  statementQuarter = null,
  statementTitle = 'Monthly Statement',
  investorIds = null, // null = generate for all investors
  get,
  all,
  run,
  dataDir,
  puppeteerLaunchOptions = {}
}) {
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }

  // Ensure destination directory exists
  const uploadDir = path.join(dataDir, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const allInvestors = await all(
    `SELECT id, email, display_label, investor_id, address, role, balance_cents, deposit_cents
     FROM users
     WHERE role != 'admin'
     ORDER BY id ASC`
  );

  // Filter to specific investors if provided, otherwise generate for all
  const investors = investorIds && investorIds.length
    ? allInvestors.filter((inv) => investorIds.includes(inv.id))
    : allInvestors;

  // Launch once for all users.
  const executablePath = await resolveChromiumExecutablePath();
console.log('Using Chromium executable path:', executablePath);

const browser = await puppeteer.launch({
  executablePath,
  args: Array.from(new Set([
    ...(chromium.args || []),
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ])),
  defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
  headless: true
});
  const page = await browser.newPage();

  let generated = 0;
  let skipped = 0;
  const errors = [];

  for (const inv of investors) {
    const userId = inv.id;
    const investorLabel = (inv.display_label || inv.email || 'Investor').trim();

    try {
      const nameParts = (investorLabel || `Investor_${userId}`).trim().split(/\s+/);
      const safeName = nameParts.length > 1
        ? `${sanitizeFileStem(nameParts[0])}_${sanitizeFileStem(nameParts[nameParts.length - 1])}`
        : sanitizeFileStem(nameParts[0]);

      let fileName;
      if (customFileName) {
        fileName = `${sanitizeFileStem(customFileName)}_${safeName}.pdf`;
      } else if (frequency === 'quarterly') {
        fileName = `${safeName}_Quarterly_Statement_Q${statementQuarter || ''}.pdf`;
      } else if (frequency === 'annually' || frequency === 'annual' || frequency === 'yearly') {
        fileName = `${safeName}_Annual_Statement_${statementYear || ''}.pdf`;
      } else {
        fileName = `${safeName}_Monthly_Statement_${statementMonth || ''}_${statementYear || ''}.pdf`;
      }
      const filePath = path.join(uploadDir, fileName);

      // Allow re-running generation for the same period: replace DB row(s) and PDF on disk.
      const existingRows = await all(
        `SELECT id, file_path FROM documents WHERE user_id = ? AND file_name = ?`,
        [userId, fileName]
      ).catch(() => []);
      if (existingRows?.length) {
        await run('DELETE FROM documents WHERE user_id = ? AND file_name = ?', [userId, fileName]).catch(() => {});
        const paths = new Set([filePath, ...(existingRows.map((r) => r.file_path).filter(Boolean))]);
        for (const p of paths) {
          try {
            if (p && fs.existsSync(p)) fs.unlinkSync(p);
          } catch (_) {
            /* ignore stale path */
          }
        }
      }

      // Opening balance = last known balance before the period starts.
      const openingRow = await get(
        `SELECT balance_cents, as_of_date
         FROM investor_balance_history
         WHERE user_id = ? AND as_of_date < ?
         ORDER BY as_of_date DESC
         LIMIT 1`,
        [userId, startDate]
      ).catch(() => null);

      // Closing balance = last known balance up to period end.
      const closingRow = await get(
        `SELECT balance_cents, as_of_date
         FROM investor_balance_history
         WHERE user_id = ? AND as_of_date <= ?
         ORDER BY as_of_date DESC
         LIMIT 1`,
        [userId, endDate]
      ).catch(() => null);

      const openingBalanceCents = Number(openingRow?.balance_cents ?? inv.balance_cents ?? 0);
      const closingBalanceCents = Number(closingRow?.balance_cents ?? inv.balance_cents ?? 0);

      const transactions = await all(
        `SELECT
          id,
          tx_date,
          tx_type,
          amount_cents,
          nav_per_share_cents,
          notes
        FROM investor_transactions
        WHERE user_id = ?
          AND tx_date >= ? AND tx_date <= ?
        ORDER BY tx_date ASC, id ASC`,
        [userId, startDate, endDate]
      );

      let depositTotalCents = 0;
      let redemptionTotalCents = 0;
      for (const tx of transactions || []) {
        const amt = Math.abs(Number(tx.amount_cents || 0));
        if (tx.tx_type === 'redemption') redemptionTotalCents += amt;
        else if (tx.tx_type === 'deposit') depositTotalCents += amt;
      }

      const html = buildStatementHtml({
        investorLabel,
        investorEmail: inv.email,
        investorId: inv.investor_id || null,
        address: inv.address || null,
        startDate,
        endDate,
        openingBalanceCents,
        depositTotalCents,
        redemptionTotalCents,
        closingBalanceCents,
        transactions: transactions || [],
        statementTitle
      });

      await renderHtmlToPdf(page, html, filePath);

      await run(
        `INSERT INTO documents (user_id, file_name, file_path, file_type)
         VALUES (?,?,?,?)`,
        [userId, fileName, filePath, 'application/pdf']
      );

      generated += 1;
    } catch (e) {
      console.error(`STATEMENT ERROR FOR USER ${inv.id}:`, e?.stack || e);
      errors.push({ userId: inv.id, investor: investorLabel, error: e?.stack || e?.message || String(e) });
    }
  }

  await browser.close();
  if (generated === 0 && errors.length) {
    throw new Error(errors.map((x) => `${x.investor || x.userId}: ${x.error}`).join(' | '));
  }
  return { startDate, endDate, generated, skipped, errors };
}

export { generateMonthlyStatements };
