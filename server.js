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
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet({ crossOriginResourcePolicy: false }));

// Persistent SQLite path
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

// DB init
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance_cents INTEGER NOT NULL DEFAULT 0,
    deposit_cents INTEGER NOT NULL DEFAULT 0,
    year_2024_deposits_cents INTEGER NOT NULL DEFAULT 0,
    year_2024_ending_balance_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Migrate existing 'users' to add 2024 columns if missing
  db.all("PRAGMA table_info(users)", [], (e, cols) => {
    if (e) return console.error('PRAGMA error:', e);
    const names = (cols || []).map(c => c.name);
    const jobs = [];
    if (!names.includes('year_2024_deposits_cents')) {
      jobs.push("ALTER TABLE users ADD COLUMN year_2024_deposits_cents INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.includes('year_2024_ending_balance_cents')) {
      jobs.push("ALTER TABLE users ADD COLUMN year_2024_ending_balance_cents INTEGER NOT NULL DEFAULT 0");
    }
    (function run(i){
      if (i >= jobs.length) return;
      db.run(jobs[i], [], () => run(i+1));
    })(0);
  });

  // Ensure admin user exists
  if (ADMIN_EMAIL) {
    db.get("SELECT id FROM users WHERE email = ?", [ADMIN_EMAIL], (err, row) => {
      if (err) {
        console.error('Error checking admin user:', err);
      } else if (!row) {
        const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
        db.run("INSERT INTO users(email, password_hash, role) VALUES(?,?,?)",
          [ADMIN_EMAIL, hash, 'admin'],
          (e2) => { if (e2) console.error('Error creating admin:', e2); }
        );
      }
    });
  }
});

// Auth helpers
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

// Routes
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  db.get("SELECT * FROM users WHERE email = ?", [String(email).toLowerCase()], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const user = { id: row.id, email: row.email, role: row.role };
    const token = signToken(user);
    res.json({
      token,
      user,
      balance_cents: row.balance_cents,
      deposit_cents: row.deposit_cents,
      year_2024_deposits_cents: row.year_2024_deposits_cents ?? 0,
      year_2024_ending_balance_cents: row.year_2024_ending_balance_cents ?? 0
    });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get(
    "SELECT id,email,role,balance_cents,deposit_cents,year_2024_deposits_cents,year_2024_ending_balance_cents FROM users WHERE id = ?",
    [req.user.sub],
    (err, row) => {
      if (err || !row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    }
  );
});

app.patch('/api/me/password', auth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'Missing fields' });
  db.get("SELECT password_hash FROM users WHERE id = ?", [req.user.sub], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'DB error' });
    const ok = bcrypt.compareSync(current_password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = bcrypt.hashSync(new_password, 10);
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.sub], function(e2){
      if (e2) return res.status(500).json({ error: 'DB error' });
      res.json({ updated: true });
    });
  });
});

// Admin: users
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  db.all(
    "SELECT id,email,role,balance_cents,deposit_cents,year_2024_deposits_cents,year_2024_ending_balance_cents,created_at FROM users ORDER BY created_at DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    }
  );
});

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const { email, password } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const pwd = password || Math.floor(100000 + Math.random()*900000).toString();
  const hash = bcrypt.hashSync(pwd, 10);
  db.run("INSERT INTO users(email, password_hash, role) VALUES(?,?,?)", [email.toLowerCase(), hash, 'user'], function(err){
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ id: this.lastID, email: email.toLowerCase(), temp_password: password ? null : pwd });
  });
});

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Bad id' });
  const newPass = Math.floor(100000 + Math.random()*900000).toString().padStart(6,'0');
  const hash = bcrypt.hashSync(newPass, 10);
  db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ updated: this.changes > 0, password: newPass });
  });
});

app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Bad id' });
  if (id === req.user.sub) return res.status(400).json({ error: 'Cannot delete your own admin user' });
  db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ deleted: this.changes > 0 });
  });
});

app.patch('/api/admin/users/:id/balance', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { balance_cents } = req.body || {};
  if (Number.isNaN(id) || !Number.isFinite(balance_cents)) return res.status(400).json({ error: 'Bad input' });
  db.run("UPDATE users SET balance_cents = ? WHERE id = ?", [Math.round(balance_cents), id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ updated: this.changes > 0 });
  });
});

app.patch('/api/admin/users/:id/deposit', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { deposit_cents } = req.body || {};
  if (Number.isNaN(id) || !Number.isFinite(deposit_cents)) return res.status(400).json({ error: 'Bad input' });
  db.run("UPDATE users SET deposit_cents = ? WHERE id = ?", [Math.round(deposit_cents), id], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ updated: this.changes > 0 });
  });
});

app.patch('/api/admin/users/:id/year/2024', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { deposits_cents, ending_balance_cents } = req.body || {};
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Bad id' });
  const dep = Number.isFinite(deposits_cents) ? Math.round(deposits_cents) : null;
  const end = Number.isFinite(ending_balance_cents) ? Math.round(ending_balance_cents) : null;
  if (dep===null && end===null) return res.status(400).json({ error: 'Nothing to update' });
  const fields = []; const params = [];
  if (dep!==null){ fields.push("year_2024_deposits_cents = ?"); params.push(dep); }
  if (end!==null){ fields.push("year_2024_ending_balance_cents = ?"); params.push(end); }
  params.push(id);
  db.run("UPDATE users SET "+fields.join(", ")+" WHERE id = ?", params, function(err){
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ updated: this.changes > 0 });
  });
});

// Admin settings: last_updated only
app.get('/api/admin/last-updated', auth, adminOnly, (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'last_updated'", [], (e, row) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    res.json({ last_updated: row?.value || null });
  });
});
app.post('/api/admin/last-updated', auth, adminOnly, (req, res) => {
  const { last_updated } = req.body || {};
  if (!last_updated || typeof last_updated !== 'string') {
    return res.status(400).json({ error: 'last_updated string required' });
  }
  db.run(
    "INSERT INTO settings(key,value) VALUES('last_updated',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [last_updated.trim()],
    (e) => {
      if (e) return res.status(500).json({ error: 'DB error' });
      res.json({ saved: true, last_updated: last_updated.trim() });
    }
  );
});

// Public stats for hero
app.get('/api/public-stats', (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'last_updated'", [], (e, lu) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    res.json({ last_updated: lu?.value || null });
  });
});

// Static
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (!fs.existsSync(indexPath)) return res.status(500).send('public/index.html not found');
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Admin email:', ADMIN_EMAIL);
  console.log('Temp admin password:', ADMIN_PASSWORD);
});
