console.log('[The Benjamin Fund] Build v7 loaded');

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
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'DKEfBpsAkMzAjyj4Boqkge7DTAE3uJahHNhmFQCjJOU';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'matthew.benjamin@thebenjaminfund.org').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GDGLfomUCV3jfnXyZEHK2A';

app.use(helmet());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const dbFile = process.env.DB_PATH || path.join('/data', 'database.sqlite');
const db = new sqlite3.Database(dbFile);

// --- DB init & migrations ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance_cents INTEGER NOT NULL DEFAULT 0,
    deposit_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Add must_change_password & deposit_cents if missing
  db.all("PRAGMA table_info(users)", [], (err, rows) => {
    if (!err) {
      const cols = rows.map(r => r.name);
      if (!cols.includes('deposit_cents')) {
        db.run("ALTER TABLE users ADD COLUMN deposit_cents INTEGER NOT NULL DEFAULT 0");
      }
      if (!cols.includes('must_change_password')) {
        db.run("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
      }
    }
  });

  // Yearly stats table for per-user summaries
  db.run(`CREATE TABLE IF NOT EXISTS yearly_stats (
    user_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    deposit_cents INTEGER NOT NULL DEFAULT 0,
    ending_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, year),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Add deposit_cents column if it doesn't exist
  db.all("PRAGMA table_info(users)", [], (err, rows) => {
    if (!err) {
      const hasDeposit = rows.some(r => (r.name || r.cid) && r.name === 'deposit_cents');
      if (!hasDeposit) {
        db.run("ALTER TABLE users ADD COLUMN deposit_cents INTEGER NOT NULL DEFAULT 0");
      }
    }
  });

  // Seed admin if missing
  db.get("SELECT * FROM users WHERE email = ?", [ADMIN_EMAIL], (err, row) => {
    if (err) { console.error(err); return; }
    if (!row) {
      const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
      db.run("INSERT INTO users (email, password_hash, role, balance_cents, deposit_cents, must_change_password) VALUES (?,?,?,?,?,?)",
        [ADMIN_EMAIL, hash, 'admin', 0, 0, 0],
        (e) => { if (e) console.error("Admin seed error", e); else console.log("Seeded admin:", ADMIN_EMAIL); }
      );
    } else {
      console.log("Admin exists:", ADMIN_EMAIL);
    }
  });
});

// Helpers
function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// --- Auth ---
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const user = { id: row.id, email: row.email, role: row.role, must_change_password: !!row.must_change_password };
    const token = signToken(user);
    res.json({
      token,
      user,
      balance_cents: row.balance_cents,
      deposit_cents: row.deposit_cents
    });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get("SELECT id, email, role, balance_cents, deposit_cents, must_change_password FROM users WHERE id = ?", [req.user.sub], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Not found' });
    // Read last_updated for user display
    db.get("SELECT value FROM settings WHERE key = 'last_updated'", [], (e, lu) => {
      const lastYear = new Date().getFullYear() - 1;
      db.get("SELECT deposit_cents, ending_cents FROM yearly_stats WHERE user_id = ? AND year = ?", [row.id, lastYear], (e3, ys) => {
      const summary = ys ? { year: lastYear, deposit_cents: ys.deposit_cents, ending_cents: ys.ending_cents } : null;
      res.json({
        user: { id: row.id, email: row.email, role: row.role, must_change_password: !!row.must_change_password },
        balance_cents: row.balance_cents,
        deposit_cents: row.deposit_cents,
        last_updated: lu?.value || null,
        last_year_summary: summary
      });
    });
    });
  });
});

// --- Admin: users ---
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  db.all("SELECT id, email, role, balance_cents, deposit_cents, created_at FROM users ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const { email, password, role = 'user' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (email, password_hash, role, balance_cents, deposit_cents, must_change_password) VALUES (?,?,?,?,?,?)",
    [email.toLowerCase(), hash, role, 0, 0, 1],
    function(err) {
      if (err) return res.status(400).json({ error: 'User exists or invalid' });
      res.json({ created: true, id: this.lastID, email: email.toLowerCase(), role, balance_cents: 0, deposit_cents: 0, password });
    });
});

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Bad id' });
  const newPass = Math.floor(100000 + Math.random()*900000).toString().padStart(6,'0');
  const hash = bcrypt.hashSync(newPass, 10);
  db.run("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?", [hash, id], function(err) {
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

// --- Admin: settings (last_updated, share_price) ---
app.get('/api/admin/last-updated', auth, adminOnly, (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'last_updated'", [], (e, row) => res.json({ last_updated: row?.value || null }));
});
app.post('/api/admin/last-updated', auth, adminOnly, (req, res) => {
  const { last_updated } = req.body || {};
  if (!last_updated || typeof last_updated !== 'string') return res.status(400).json({ error: 'last_updated string required' });
  db.run("INSERT INTO settings(key,value) VALUES('last_updated',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [last_updated], (e) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    res.json({ saved: true, last_updated });
  });
});
app.get('/api/admin/share-price', auth, adminOnly, (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'share_price'", [], (e, row) => res.json({ share_price: row?.value || null }));
});
app.post('/api/admin/share-price', auth, adminOnly, (req, res) => {
  const { share_price } = req.body || {};
  if (share_price === undefined) return res.status(400).json({ error: 'share_price required' });
  db.run("INSERT INTO settings(key,value) VALUES('share_price',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(share_price)], (e) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    res.json({ saved: true, share_price: Number(share_price) });
  });
});


// --- Admin: yearly stats (per-user) ---
app.get('/api/admin/users/:id/yearly', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const year = parseInt(req.query.year || (new Date().getFullYear() - 1), 10);
  if (Number.isNaN(id) || Number.isNaN(year)) return res.status(400).json({ error: 'Bad input' });
  db.get("SELECT user_id, year, deposit_cents, ending_cents FROM yearly_stats WHERE user_id = ? AND year = ?", [id, year], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(row || { user_id: id, year, deposit_cents: 0, ending_cents: 0 });
  });
});
app.post('/api/admin/users/:id/yearly', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { year, deposit_cents, ending_cents } = req.body || {};
  if (Number.isNaN(id) || !Number.isFinite(year) || !Number.isFinite(deposit_cents) || !Number.isFinite(ending_cents)) {
    return res.status(400).json({ error: 'Bad input' });
  }
  db.run("INSERT INTO yearly_stats(user_id, year, deposit_cents, ending_cents) VALUES (?,?,?,?) ON CONFLICT(user_id, year) DO UPDATE SET deposit_cents=excluded.deposit_cents, ending_cents=excluded.ending_cents",
    [id, Math.round(year), Math.round(deposit_cents), Math.round(ending_cents)], function(err){
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ saved: true });
    });
});

// --- Public stats for hero ---
app.get('/api/public-stats', (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'share_price'", [], (e1, sp) => {
    db.get("SELECT value FROM settings WHERE key = 'last_updated'", [], (e2, lu) => {
      const share = sp?.value ? Number(sp.value) : null;
      res.json({ share_price: share, last_updated: lu?.value || null });
    });
  });
});


// --- User: change password ---
app.post('/api/users/change-password', auth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ error: 'Both old_password and new_password are required' });
  db.get("SELECT id, password_hash FROM users WHERE id = ?", [req.user.sub], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'User not found' });
    const ok = bcrypt.compareSync(old_password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect current password' });
    const hash = bcrypt.hashSync(new_password, 10);
    db.run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [hash, req.user.sub], function(e){
      if (e) return res.status(500).json({ error: 'DB error' });
      res.json({ changed: true });
    });
  });
});


// --- Admin: pre-login message ---
app.get('/api/admin/prelogin-message', auth, adminOnly, (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'prelogin_message'", [], (e, row) => {
    res.json({ message: row?.value || '' });
  });
});
app.post('/api/admin/prelogin-message', auth, adminOnly, (req, res) => {
  const { message } = req.body || {};
  const val = (message || '').toString();
  db.run("INSERT INTO settings(key,value) VALUES('prelogin_message',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [val], (e) => {
    if (e) return res.status(500).json({ error: 'DB error' });
    res.json({ saved: true, message: val });
  });
});

// --- Public: pre-login message ---
app.get('/api/public-message', (req, res) => {
  db.get("SELECT value FROM settings WHERE key = 'prelogin_message'", [], (e, row) => {
    res.json({ message: row?.value || '' });
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
