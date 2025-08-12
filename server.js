
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
const JWT_SECRET = process.env.JWT_SECRET || 'KuotBxZ9A95tjMyfpWr1TlZonHxjg6EcJ0gbenJyKzo';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'matthew.benjamin@thebenjaminfund.org').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'fX1oIXoe1wfmmP-P5qxqMQ';

app.use(helmet());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const dbFile = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbFile);

// Initialize and seed admin
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.get("SELECT * FROM users WHERE email = ?", [ADMIN_EMAIL], (err, row) => {
    if (err) { console.error(err); return; }
    if (!row) {
      const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
      db.run(
        "INSERT INTO users (email, password_hash, role, balance_cents) VALUES (?,?,?,?)",
        [ADMIN_EMAIL, hash, 'admin', 0],
        (e) => {
          if (e) console.error("Admin seed error", e);
          else console.log("Seeded admin:", ADMIN_EMAIL);
        }
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
  catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Public auth
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (email, password_hash, role, balance_cents) VALUES (?,?,?,?)",
    [email.toLowerCase(), hash, 'user', 0],
    function(err) {
      if (err) return res.status(400).json({ error: 'User exists or invalid' });
      const user = { id: this.lastID, email: email.toLowerCase(), role: 'user' };
      const token = signToken(user);
      res.json({ token, user, balance_cents: 0 });
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
    res.json({ token, user, balance_cents: row.balance_cents });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get("SELECT id, email, role, balance_cents FROM users WHERE id = ?", [req.user.sub], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Not found' });
    res.json({ user: { id: row.id, email: row.email, role: row.role }, balance_cents: row.balance_cents });
  });
});

// Admin
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  db.all("SELECT id, email, role, balance_cents, created_at FROM users ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const { email, password, role = 'user' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (email, password_hash, role, balance_cents) VALUES (?,?,?,?)",
    [email.toLowerCase(), hash, role, 0],
    function(err) {
      if (err) return res.status(400).json({ error: 'User exists or invalid' });
      res.json({ created: true, id: this.lastID, email: email.toLowerCase(), role, balance_cents: 0 });
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

app.post('/api/admin/reset-password', auth, adminOnly, (req, res) => {
  const { email, new_password } = req.body || {};
  if (!email || !new_password) return res.status(400).json({ error: 'Email and new_password required' });
  const hash = bcrypt.hashSync(new_password, 10);
  db.run("UPDATE users SET password_hash = ? WHERE email = ?", [hash, email.toLowerCase()], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ updated: this.changes > 0 });
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
