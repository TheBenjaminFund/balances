import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors({ origin: true, credentials: true }));
app.use(helmet({ crossOriginResourcePolicy: false }));

let dataDir = process.env.DATA_DIR;
try {
  if (!dataDir) dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
} catch (e) {
  console.warn('DATA_DIR not usable, falling back to ./data:', e.message);
  dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}
const dbFile = path.join(dataDir, 'data.sqlite');
console.log('SQLite DB path:', dbFile);
const db = new sqlite3.Database(dbFile);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function parseId(v) {
  const id = parseInt(v, 10);
  return Number.isNaN(id) ? null : id;
}
function cleanMoneyCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function sanitizeDate(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}
function sanitizeYear(v) {
  const y = parseInt(v, 10);
  if (Number.isNaN(y) || y < 2000 || y > 3000) return null;
  return y;
}

function deriveYearlyTotalsFromTransactions(transactions = []) {
  const map = new Map();
  for (const tx of transactions) {
    const year = sanitizeYear(String(tx?.tx_date || '').slice(0, 4));
    if (!year) continue;
    const amt = Math.abs(Number(tx?.amount_cents || 0));
    const signed = tx?.tx_type === 'redemption' ? -amt : amt;
    map.set(year, (map.get(year) || 0) + signed);
  }
  return [...map.entries()]
    .map(([year, net_deposits_cents]) => ({ year, net_deposits_cents }))
    .sort((a, b) => a.year - b.year);
}

function deriveLatestBalanceCents(balanceHistory = [], fallback = 0) {
  if (balanceHistory.length) return Math.max(0, Number(balanceHistory[balanceHistory.length - 1]?.balance_cents || 0));
  return Math.max(0, Number(fallback || 0));
}

function sumNetDeposits(yearlyTotals = [], fallback = 0) {
  if (yearlyTotals.length) return yearlyTotals.reduce((sum, row) => sum + Number(row?.net_deposits_cents || 0), 0);
  return Number(fallback || 0);
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance_cents INTEGER NOT NULL DEFAULT 0,
    deposit_cents INTEGER NOT NULL DEFAULT 0,
    year_2024_deposits_cents INTEGER NOT NULL DEFAULT 0,
    year_2024_ending_balance_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    display_label TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS investor_yearly_totals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    net_deposits_cents INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, year),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS investor_balance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    as_of_date TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, as_of_date),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS investor_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tx_date TEXT NOT NULL,
    tx_type TEXT NOT NULL CHECK (tx_type IN ('deposit','redemption')),
    amount_cents INTEGER NOT NULL,
    nav_per_share_cents INTEGER,
    notes TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  const cols = await all('PRAGMA table_info(users)');
  const names = (cols || []).map(c => c.name);
  if (!names.includes('year_2024_deposits_cents')) {
    await run("ALTER TABLE users ADD COLUMN year_2024_deposits_cents INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('year_2024_ending_balance_cents')) {
    await run("ALTER TABLE users ADD COLUMN year_2024_ending_balance_cents INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.includes('display_label')) {
    await run("ALTER TABLE users ADD COLUMN display_label TEXT");
  }

  // Seed / ensure admin user.
  if (ADMIN_EMAIL) {
    const existing = await get('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]).catch(() => null);
    if (!existing) {
      const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
      await run('INSERT INTO users(email, password_hash, role) VALUES(?,?,?)', [ADMIN_EMAIL, hash, 'admin']).catch((e) => {
        console.error('Error creating admin:', e.message);
      });
    }
  }

  // One-time migration of legacy 2024 deposits into new yearly totals when absent.
  await run(`INSERT INTO investor_yearly_totals(user_id, year, net_deposits_cents)
    SELECT id, 2024, COALESCE(year_2024_deposits_cents, 0)
    FROM users u
    WHERE COALESCE(year_2024_deposits_cents, 0) != 0
      AND NOT EXISTS (
        SELECT 1 FROM investor_yearly_totals y WHERE y.user_id = u.id AND y.year = 2024
      )`).catch(() => {});
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

async function loadInvestorBundle(userId) {
  const user = await get('SELECT id,email,role,balance_cents,deposit_cents,created_at,display_label FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const storedYearlyTotals = await all(
    'SELECT year, net_deposits_cents FROM investor_yearly_totals WHERE user_id = ? ORDER BY year ASC',
    [userId]
  );
  const balanceHistory = await all(
    'SELECT as_of_date, balance_cents FROM investor_balance_history WHERE user_id = ? ORDER BY as_of_date ASC',
    [userId]
  );
  const transactions = await all(
    `SELECT id, tx_date, tx_type, amount_cents, nav_per_share_cents, notes
     FROM investor_transactions WHERE user_id = ? ORDER BY tx_date DESC, id DESC`,
    [userId]
  );
  const derivedYearlyTotals = deriveYearlyTotalsFromTransactions(transactions);
  const yearlyTotals = derivedYearlyTotals.length ? derivedYearlyTotals : storedYearlyTotals;
  user.manual_balance_cents = Number(user.balance_cents || 0);
  user.manual_deposit_cents = Number(user.deposit_cents || 0);
  user.balance_cents = deriveLatestBalanceCents(balanceHistory, user.manual_balance_cents);
  user.deposit_cents = sumNetDeposits(yearlyTotals, user.manual_deposit_cents);
  user.uses_derived_totals = derivedYearlyTotals.length > 0;
  user.uses_derived_balance = balanceHistory.length > 0;
  return { user, yearlyTotals, balanceHistory, transactions };
}

async function replaceYearlyTotals(userId, rows) {
  await run('DELETE FROM investor_yearly_totals WHERE user_id = ?', [userId]);
  for (const row of rows) {
    await run(
      'INSERT INTO investor_yearly_totals(user_id, year, net_deposits_cents) VALUES(?,?,?)',
      [userId, row.year, row.net_deposits_cents]
    );
  }
}

async function replaceBalanceHistoryForYear(userId, year, rows) {
  await run("DELETE FROM investor_balance_history WHERE user_id = ? AND substr(as_of_date,1,4) = ?", [userId, String(year)]);
  for (const row of rows) {
    await run(
      'INSERT INTO investor_balance_history(user_id, as_of_date, balance_cents) VALUES(?,?,?)',
      [userId, row.as_of_date, Math.max(0, row.balance_cents)]
    );
  }
}

async function replaceTransactions(userId, rows) {
  await run('DELETE FROM investor_transactions WHERE user_id = ?', [userId]);
  for (const row of rows) {
    await run(
      'INSERT INTO investor_transactions(user_id, tx_date, tx_type, amount_cents, nav_per_share_cents, notes) VALUES(?,?,?,?,?,?)',
      [userId, row.tx_date, row.tx_type, row.amount_cents, row.nav_per_share_cents, row.notes || null]
    );
  }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, display_label } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const row = await get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
    if (!row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const user = { id: row.id, email: row.email, role: row.role };
    const token = signToken(user);
    res.json({ token, user });
  } catch {
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const bundle = await loadInvestorBundle(req.user.sub);
    if (!bundle) return res.status(404).json({ error: 'Not found' });
    res.json(bundle);
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.patch('/api/me/password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ error: 'Missing fields' });
    const row = await get('SELECT password_hash FROM users WHERE id = ?', [req.user.sub]);
    if (!row) return res.status(500).json({ error: 'DB error' });
    const ok = bcrypt.compareSync(current_password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = bcrypt.hashSync(new_password, 10);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.sub]);
    res.json({ updated: true });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const rows = await all(`
      SELECT
        u.id,
        u.email,
        u.role,
        u.created_at,
        u.display_label,
        COALESCE((
          SELECT bh.balance_cents
          FROM investor_balance_history bh
          WHERE bh.user_id = u.id
          ORDER BY bh.as_of_date DESC, bh.id DESC
          LIMIT 1
        ), u.balance_cents, 0) AS balance_cents,
        COALESCE((
          SELECT SUM(CASE WHEN tx.tx_type = 'redemption' THEN -ABS(tx.amount_cents) ELSE ABS(tx.amount_cents) END)
          FROM investor_transactions tx
          WHERE tx.user_id = u.id
        ), (
          SELECT SUM(iyt.net_deposits_cents)
          FROM investor_yearly_totals iyt
          WHERE iyt.user_id = u.id
        ), u.deposit_cents, 0) AS deposit_cents
      FROM users u
      ORDER BY role DESC, COALESCE(NULLIF(display_label,''), email) COLLATE NOCASE ASC
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    const bundle = await loadInvestorBundle(id);
    if (!bundle) return res.status(404).json({ error: 'Not found' });
    res.json(bundle);
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const { email, password, display_label } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });
    const pwd = password || Math.floor(100000 + Math.random() * 900000).toString();
    const hash = bcrypt.hashSync(pwd, 10);
    const label = typeof display_label === 'string' ? display_label.trim().slice(0, 80) : null;
    const result = await run('INSERT INTO users(email, password_hash, role, display_label) VALUES(?,?,?,?)', [String(email).toLowerCase(), hash, 'user', label || null]);
    res.json({ id: result.lastID, email: String(email).toLowerCase(), display_label: label || null, temp_password: password ? null : pwd });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.patch('/api/admin/users/:id/summary', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    const { display_label } = req.body || {};
    const label = typeof display_label === 'string' ? display_label.trim().slice(0, 80) : null;
    if (display_label === undefined) return res.status(400).json({ error: 'Nothing to update' });
    await run('UPDATE users SET display_label = ? WHERE id = ?', [label || null, id]);
    res.json({ updated: true });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.put('/api/admin/users/:id/yearly-totals', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!id || !rows) return res.status(400).json({ error: 'Bad input' });
    const clean = [];
    for (const row of rows) {
      const year = sanitizeYear(row?.year);
      const net = cleanMoneyCents(row?.net_deposits_cents);
      if (year === null || net === null) continue;
      clean.push({ year, net_deposits_cents: net });
    }
    await replaceYearlyTotals(id, clean);
    res.json({ updated: true, count: clean.length });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.put('/api/admin/users/:id/balance-history/:year', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const year = sanitizeYear(req.params.year);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!id || !year || !rows) return res.status(400).json({ error: 'Bad input' });
    const clean = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowNum = i + 1;
      const as_of_date = sanitizeDate(row?.as_of_date);
      const balance_cents = cleanMoneyCents(row?.balance_cents);
      if (!as_of_date || balance_cents === null) {
        return res.status(400).json({ error: `Row ${rowNum} is missing a valid date or balance` });
      }
      if (!as_of_date.startsWith(String(year))) {
        return res.status(400).json({ error: `Row ${rowNum} must use a ${year} date` });
      }
      if (seen.has(as_of_date)) {
        return res.status(400).json({ error: `Duplicate date found: ${as_of_date}` });
      }
      seen.add(as_of_date);
      clean.push({ as_of_date, balance_cents });
    }
    clean.sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
    await replaceBalanceHistoryForYear(id, year, clean);
    res.json({ updated: true, count: clean.length });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.put('/api/admin/users/:id/transactions', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!id || !rows) return res.status(400).json({ error: 'Bad input' });
    const clean = [];
    for (const row of rows) {
      const tx_date = sanitizeDate(row?.tx_date);
      const tx_type = row?.tx_type === 'redemption' ? 'redemption' : row?.tx_type === 'deposit' ? 'deposit' : null;
      const amount_cents = cleanMoneyCents(row?.amount_cents);
      const nav_per_share_cents = row?.nav_per_share_cents === '' || row?.nav_per_share_cents === null || row?.nav_per_share_cents === undefined
        ? null
        : cleanMoneyCents(row?.nav_per_share_cents);
      const notes = typeof row?.notes === 'string' ? row.notes.trim().slice(0, 250) : null;
      if (!tx_date || !tx_type || amount_cents === null) continue;
      clean.push({ tx_date, tx_type, amount_cents, nav_per_share_cents, notes });
    }
    clean.sort((a, b) => a.tx_date.localeCompare(b.tx_date));
    await replaceTransactions(id, clean);
    res.json({ updated: true, count: clean.length });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    const newPass = Math.floor(100000 + Math.random() * 900000).toString().padStart(6, '0');
    const hash = bcrypt.hashSync(newPass, 10);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
    res.json({ updated: true, password: newPass });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Bad id' });
    if (id === req.user.sub) return res.status(400).json({ error: 'Cannot delete your own admin user' });
    await run('DELETE FROM investor_transactions WHERE user_id = ?', [id]);
    await run('DELETE FROM investor_balance_history WHERE user_id = ?', [id]);
    await run('DELETE FROM investor_yearly_totals WHERE user_id = ?', [id]);
    const result = await run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ deleted: result.changes > 0 });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/admin/last-updated', auth, adminOnly, async (req, res) => {
  try {
    const row = await get("SELECT value FROM settings WHERE key = 'last_updated'");
    res.json({ last_updated: row?.value || null });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/admin/last-updated', auth, adminOnly, async (req, res) => {
  try {
    const { last_updated } = req.body || {};
    if (!last_updated || typeof last_updated !== 'string') return res.status(400).json({ error: 'last_updated string required' });
    await run(
      "INSERT INTO settings(key,value) VALUES('last_updated',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [last_updated.trim()]
    );
    res.json({ saved: true, last_updated: last_updated.trim() });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/public-stats', async (req, res) => {
  try {
    const row = await get("SELECT value FROM settings WHERE key = 'last_updated'");
    res.json({ last_updated: row?.value || null });
  } catch {
    res.status(500).json({ error: 'DB error' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (!fs.existsSync(indexPath)) return res.status(500).send('public/index.html not found');
  res.sendFile(indexPath);
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Admin email:', ADMIN_EMAIL);
    console.log('Temp admin password:', ADMIN_PASSWORD);
  });
}).catch((e) => {
  console.error('Failed to initialize DB:', e);
  process.exit(1);
});
