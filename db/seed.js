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
  const adminUser = await db.get(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Chris', 'admin@vividviews.co', adminHash, 'admin']
  );

  // Create client user
  const clientUser = await db.get(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Demo User', 'demo@client.com', clientHash, 'client']
  );

  // Create client record
  const client = await db.get(
    'INSERT INTO clients (user_id, company_name) VALUES ($1, $2) RETURNING id',
    [clientUser.id, 'Demo Client Co']
  );

  // Create service types
  const st1 = await db.get(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2) RETURNING id',
    [client.id, 'Website Design']
  );
  const st2 = await db.get(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2) RETURNING id',
    [client.id, 'AI Automation']
  );
  const st3 = await db.get(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2) RETURNING id',
    [client.id, '3D Renders']
  );

  // Create sample service requests
  await db.get(
    'INSERT INTO service_requests (client_id, service_type_id, description, urgency, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [client.id, st1.id, 'Need a modern landing page for our new product launch. Should include hero section, features, pricing, and contact form.', 'high', 'in_progress']
  );
  await db.get(
    'INSERT INTO service_requests (client_id, service_type_id, description, urgency, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [client.id, st3.id, 'Convert 5 apartment floor plans from 2D to 3D renders with furniture staging.', 'medium', 'submitted']
  );

  console.log('✅ Seed data created');
  console.log('   Admin: admin@vividviews.co / admin123');
  console.log('   Client: demo@client.com / client123');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
