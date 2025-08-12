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
const JWT_SECRET = process.env.JWT_SECRET || '014M95zm9SnIoFiamiYURcCuzovN8jsbsTvgUWvNPl4';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'matthew.benjamin@thebenjaminfund.org').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ne4M94hFdb1ncqGUZQb21A';

app.use(helmet());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const dbFile = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

// Initialize tables and seed admin
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

  // Backfill deposit_cents if missing (older DBs)
  db.all("PRAGMA table_info(users)", [], (err, cols) => {
    if (!err && Array.isArray(cols)) {
      const hasDeposit = cols.some(c => c.name === 'deposit_cents');
      if (!hasDeposit) {
        db.run("ALTER TABLE users ADD COLUMN deposit_cents INTEGER NOT NULL DEFAULT 0");
      }
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.get("SELECT * FROM users WHERE email = ?", [ADMIN_EMAIL], (err, row) => {
    if (err) { console.error(err); return; }
    if (!row) {
      const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
      db.run("INSERT INTO users (email, password_hash, role, balance_cents, deposit_cents) VALUES (?,?,?,?,?)",
        [ADMIN_EMAIL, hash, 'admin', 0, 0],
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

// Settings helpers
function getSetting(key, cb) {
  db.get("SELECT value FROM settings WHERE key = ?", [key], (err, row) => cb(err, row?.value ?? null));
}
function setSetting(key, value, cb) {
  db.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value], cb);
}

// Public auth
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (email, password_hash, role, balance_cents, deposit_cents) VALUES (?,?,?,?,?)",
    [email.toLowerCase(), hash, 'user', 0, 0],
    function(err) {
      if (err) return res.status(400).json({ error: 'User exists or invalid' });
      const user = { id: this.lastID, email: email.toLowerCase(), role: 'user' };
      const token = signToken(user);
      res.json({ token, user, balance_cents: 0, deposit_cents: 0 });
    });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  db.get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const user = { id: row.id, email: row.email, role: row.role };
    const token = signToken(user);
    getSetting('last_updated', (e, v) => {
      res.json({
        token,
        user,
        balance_cents: row.balance_cents,
        deposit_cents: row.deposit_cents,
        last_updated: v
      });
    });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get("SELECT id, email, role, balance_cents, deposit_cents FROM users WHERE id = ?", [req.user.sub], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Not found' });
    getSetting('last_updated', (e, v) => {
      res.json({ user: { id: row.id, email: row.email, role: row.role },
                 balance_cents: row.balance_cents,
                 deposit_cents: row.deposit_cents,
                 last_updated: v });
    });
  });
});

// Public: last updated
app.get('/api/last-updated', (req, res) => {
  getSetting('last_updated', (e, v) => res.json({ last_updated: v }));
});

// Admin endpoints
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
  db.run("INSERT INTO users (email, password_hash, role, balance_cents, deposit_cents) VALUES (?,?,?,?,?)",
    [email.toLowerCase(), hash, role, 0, 0],
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

// Admin: last updated
app.get('/api/admin/last-updated', auth, adminOnly, (req, res) => {
  getSetting('last_updated', (e, v) => res.json({ last_updated: v }));
});
app.post('/api/admin/last-updated', auth, adminOnly, (req, res) => {
  const { last_updated } = req.body || {};
  if (!last_updated || typeof last_updated !== 'string') return res.status(400).json({ error: 'last_updated string required' });
  setSetting('last_updated', last_updated, (err) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ saved: true, last_updated });
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
