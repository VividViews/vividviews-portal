require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../utils/db');
const { migrate } = require('./schema');

async function seed() {
  await migrate();

  // Check if already seeded
  const existing = await db.get('SELECT id FROM users WHERE email = $1', ['admin@vividviews.co']);
  if (existing) {
    console.log('⚠️  Already seeded, skipping');
    return;
  }

  const adminHash = await bcrypt.hash('admin123', 10);
  const clientHash = await bcrypt.hash('client123', 10);

  // Create admin user
  const adminUser = await db.run(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
    ['Chris', 'admin@vividviews.co', adminHash, 'admin']
  );

  // Create client user
  const clientUser = await db.run(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
    ['Demo User', 'demo@client.com', clientHash, 'client']
  );

  // Create client record
  const client = await db.run(
    'INSERT INTO clients (user_id, company_name) VALUES ($1, $2)',
    [clientUser.lastID, 'Demo Client Co']
  );

  // Create service types
  const st1 = await db.run(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2)',
    [client.lastID, 'Website Design']
  );
  const st2 = await db.run(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2)',
    [client.lastID, 'AI Automation']
  );
  const st3 = await db.run(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2)',
    [client.lastID, '3D Renders']
  );

  // Create sample service requests
  await db.run(
    'INSERT INTO service_requests (client_id, service_type_id, description, urgency, status) VALUES ($1, $2, $3, $4, $5)',
    [client.lastID, st1.lastID, 'Need a modern landing page for our new product launch. Should include hero section, features, pricing, and contact form.', 'high', 'in_progress']
  );
  await db.run(
    'INSERT INTO service_requests (client_id, service_type_id, description, urgency, status) VALUES ($1, $2, $3, $4, $5)',
    [client.lastID, st3.lastID, 'Convert 5 apartment floor plans from 2D to 3D renders with furniture staging.', 'medium', 'submitted']
  );

  console.log('✅ Seed data created');
  console.log('   Admin: admin@vividviews.co / admin123');
  console.log('   Client: demo@client.com / client123');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
