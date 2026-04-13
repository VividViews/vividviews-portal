const db = require('../utils/db');

async function migrate() {
  if (db.type === 'sqlite') {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('admin','client')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        client_type TEXT NOT NULL DEFAULT 'standard',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS carwash_brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        brand_name TEXT NOT NULL,
        logo_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS carwash_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id INTEGER NOT NULL REFERENCES carwash_brands(id) ON DELETE CASCADE,
        site_name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS service_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS service_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        service_type_id INTEGER NOT NULL REFERENCES service_types(id),
        description TEXT NOT NULL,
        urgency TEXT NOT NULL DEFAULT 'low' CHECK(urgency IN ('low','medium','high','urgent')),
        status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','in_review','in_progress','complete')),
        admin_notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS request_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        comment TEXT NOT NULL,
        comment_type TEXT NOT NULL DEFAULT 'comment',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
        invoiced INTEGER NOT NULL DEFAULT 0,
        paid INTEGER NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS client_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS request_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_request_id INTEGER NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        feedback TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('admin','client')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        client_type TEXT NOT NULL DEFAULT 'standard',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS carwash_brands (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        brand_name TEXT NOT NULL,
        logo_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS carwash_sites (
        id SERIAL PRIMARY KEY,
        brand_id INTEGER NOT NULL REFERENCES carwash_brands(id) ON DELETE CASCADE,
        site_name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS service_types (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS service_requests (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        service_type_id INTEGER NOT NULL REFERENCES service_types(id),
        description TEXT NOT NULL,
        urgency TEXT NOT NULL DEFAULT 'low' CHECK(urgency IN ('low','medium','high','urgent')),
        status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','in_review','in_progress','complete')),
        admin_notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS request_comments (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        comment TEXT NOT NULL,
        comment_type TEXT NOT NULL DEFAULT 'comment',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value DECIMAL(10,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
        invoiced BOOLEAN NOT NULL DEFAULT FALSE,
        paid BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS client_notes (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS request_ratings (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL UNIQUE REFERENCES service_requests(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        feedback TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid)
      );

      CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
    `);
  }
  // Add client_type column to existing databases
  if (db.type === 'pg') {
    try {
      await db.exec("ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'standard'");
    } catch (e) { /* column may already exist */ }
  }

  console.log('✅ Database migrations complete');
}

module.exports = { migrate };
