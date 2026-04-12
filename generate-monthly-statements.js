// Function for generating monthly statements for all investors STRAIGHT from the db
// for testing purposes

import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateMonthlyStatements } from './statementGenerator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function fmtYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function prevMonthRange() {
  const now = new Date();
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
  return { startDate: fmtYmd(prevStart), endDate: fmtYmd(prevEnd) };
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (!found) return null;
  return found.slice(prefix.length);
}

async function main() {
  // Resolve data directory (same convention as server.js)
  let dataDir = process.env.DATA_DIR;
  try {
    if (!dataDir) dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    // Fallback to ./data
    dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  }

  const startDate = parseArg('start') || prevMonthRange().startDate;
  const endDate = parseArg('end') || prevMonthRange().endDate;
  const fileNamePrefix = parseArg('prefix') || 'statement';

  const dbFile = path.join(dataDir, 'data.sqlite');
  const db = new sqlite3.Database(dbFile);

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
  }

  function all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }

  try {
    const result = await generateMonthlyStatements({ startDate, endDate, fileNamePrefix, dataDir, get, all, run });
    console.log('Statement generation result:');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error('Generation failed:', e?.message || String(e));
  process.exit(1);
});