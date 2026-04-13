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
        access_level TEXT NOT NULL DEFAULT 'client',
        site_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS client_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        client_type TEXT NOT NULL DEFAULT 'standard',
        client_type_id INTEGER REFERENCES client_types(id) ON DELETE SET NULL,
        onboarded INTEGER NOT NULL DEFAULT 0,
        logo_url TEXT DEFAULT '',
        brand_color TEXT DEFAULT '#00d4ff',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS client_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        site_name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        site_manager_name TEXT,
        site_manager_phone TEXT,
        site_manager_email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
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
        default_urgency TEXT NOT NULL DEFAULT 'medium',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS service_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        service_type_id INTEGER NOT NULL REFERENCES service_types(id),
        site_id INTEGER REFERENCES client_sites(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        urgency TEXT NOT NULL DEFAULT 'low' CHECK(urgency IN ('low','medium','high','urgent')),
        status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','in_review','in_progress','complete')),
        is_emergency INTEGER NOT NULL DEFAULT 0,
        admin_notes TEXT DEFAULT '',
        first_response_at DATETIME,
        resolved_at DATETIME,
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

      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role_name TEXT NOT NULL DEFAULT 'Technician',
        hourly_rate REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS employee_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        site_id INTEGER REFERENCES client_sites(id) ON DELETE SET NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, client_id, site_id)
      );

      CREATE TABLE IF NOT EXISTS emergency_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        base_fee REAL NOT NULL DEFAULT 0,
        approved_by INTEGER REFERENCES users(id),
        approved_at DATETIME,
        dispatched_employee_id INTEGER REFERENCES employees(id),
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS emergency_time_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emergency_request_id INTEGER NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        clocked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        clocked_out_at DATETIME,
        total_minutes INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS emergency_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emergency_request_id INTEGER NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
        base_fee REAL NOT NULL DEFAULT 0,
        hourly_rate REAL NOT NULL DEFAULT 0,
        total_hours REAL NOT NULL DEFAULT 0,
        labor_cost REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        item_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 2,
        unit TEXT NOT NULL DEFAULT 'units',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        change_type TEXT NOT NULL,
        quantity_change INTEGER NOT NULL,
        quantity_after INTEGER NOT NULL,
        note TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT DEFAULT '',
        read INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS request_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        service_type_id INTEGER REFERENCES service_types(id) ON DELETE SET NULL,
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT 'all',
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS client_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        doc_type TEXT NOT NULL DEFAULT 'other',
        description TEXT DEFAULT '',
        uploaded_by INTEGER REFERENCES users(id),
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

      CREATE TABLE IF NOT EXISTS client_types (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        client_type TEXT NOT NULL DEFAULT 'standard',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS client_sites (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        site_name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        site_manager_name TEXT,
        site_manager_phone TEXT,
        site_manager_email TEXT,
        status TEXT NOT NULL DEFAULT 'active',
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
        first_response_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
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

      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role_name TEXT NOT NULL DEFAULT 'Technician',
        hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS employee_assignments (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        site_id INTEGER REFERENCES client_sites(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(employee_id, client_id, site_id)
      );

      CREATE TABLE IF NOT EXISTS emergency_requests (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        base_fee DECIMAL(8,2) NOT NULL DEFAULT 0,
        approved_by INTEGER REFERENCES users(id),
        approved_at TIMESTAMPTZ,
        dispatched_employee_id INTEGER REFERENCES employees(id),
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS emergency_time_logs (
        id SERIAL PRIMARY KEY,
        emergency_request_id INTEGER NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        clocked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        clocked_out_at TIMESTAMPTZ,
        total_minutes INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS emergency_invoices (
        id SERIAL PRIMARY KEY,
        emergency_request_id INTEGER NOT NULL REFERENCES emergency_requests(id) ON DELETE CASCADE,
        base_fee DECIMAL(8,2) NOT NULL DEFAULT 0,
        hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 0,
        total_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
        labor_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        item_name TEXT NOT NULL,
        description TEXT DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 2,
        unit TEXT NOT NULL DEFAULT 'units',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        change_type TEXT NOT NULL,
        quantity_change INTEGER NOT NULL,
        quantity_after INTEGER NOT NULL,
        note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid)
      );

      CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT DEFAULT '',
        read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS request_templates (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        service_type_id INTEGER REFERENCES service_types(id) ON DELETE SET NULL,
        description TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT 'all',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS client_documents (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        doc_type TEXT NOT NULL DEFAULT 'other',
        description TEXT DEFAULT '',
        uploaded_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ALTER TABLE additions for PostgreSQL
    try { await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level TEXT NOT NULL DEFAULT 'client'"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES client_sites(id) ON DELETE SET NULL"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES client_sites(id) ON DELETE SET NULL"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT FALSE"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE service_types ADD COLUMN IF NOT EXISTS default_urgency TEXT NOT NULL DEFAULT 'medium'"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type_id INTEGER REFERENCES client_types(id) ON DELETE SET NULL"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'standard'"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT ''"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#00d4ff'"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ"); } catch (e) { /* exists */ }
    try { await db.exec("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"); } catch (e) { /* exists */ }
  }

  // Seed default client types if empty
  try {
    const existing = await db.query('SELECT COUNT(*) as count FROM client_types');
    if (parseInt(existing[0].count) === 0) {
      const types = ['Standard', 'Car Wash', 'Healthcare', 'Real Estate'];
      for (const t of types) {
        await db.run('INSERT INTO client_types (name) VALUES ($1)', [t]);
      }
      console.log('✅ Seeded default client types');
    }
  } catch (e) {
    console.error('Client type seed error:', e.message);
  }

  console.log('✅ Database migrations complete');
}

module.exports = { migrate };
