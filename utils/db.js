const path = require('path');

let db;

if (process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  db = {
    type: 'pg',
    pool,
    async query(text, params) {
      const res = await pool.query(text, params);
      return res.rows;
    },
    async get(text, params) {
      const res = await pool.query(text, params);
      return res.rows[0] || null;
    },
    async run(text, params) {
      const res = await pool.query(text, params);
      return { changes: res.rowCount, lastID: res.rows[0]?.id };
    },
    async exec(text) {
      await pool.query(text);
    }
  };
} else {
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '..', 'vividviews.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  db = {
    type: 'sqlite',
    sqlite,
    async query(text, params = []) {
      const stmt = sqlite.prepare(convertPlaceholders(text));
      return stmt.all(...convertParams(params));
    },
    async get(text, params = []) {
      const stmt = sqlite.prepare(convertPlaceholders(text));
      return stmt.get(...convertParams(params)) || null;
    },
    async run(text, params = []) {
      const stmt = sqlite.prepare(convertPlaceholders(text));
      const res = stmt.run(...convertParams(params));
      return { changes: res.changes, lastID: res.lastInsertRowid };
    },
    async exec(text) {
      sqlite.exec(text);
    }
  };
}

// Convert $1, $2... to ? for SQLite
function convertPlaceholders(text) {
  let i = 0;
  return text.replace(/\$\d+/g, () => '?');
}

function convertParams(params) {
  if (!params) return [];
  return params.map(p => (p === undefined ? null : p));
}

module.exports = db;
