const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../utils/db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAdmin);

// Dashboard
router.get('/', async (req, res) => {
  const clients = await db.query('SELECT COUNT(*) as count FROM clients');
  const submitted = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'submitted'");
  const inProgress = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'in_progress'");
  const inReview = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'in_review'");
  const complete = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'complete'");

  const recentRequests = await db.query(`
    SELECT sr.*, c.company_name, st.name as service_type_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    ORDER BY sr.created_at DESC
    LIMIT 10
  `);

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    user: req.session.user,
    stats: {
      clients: clients[0].count,
      submitted: submitted[0].count,
      inReview: inReview[0].count,
      inProgress: inProgress[0].count,
      complete: complete[0].count
    },
    recentRequests
  });
});

// Clients list
router.get('/clients', async (req, res) => {
  const clients = await db.query(`
    SELECT c.*, u.name, u.email,
      (SELECT COUNT(*) FROM service_requests WHERE client_id = c.id) as request_count
    FROM clients c
    JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC
  `);
  res.render('admin/clients', { title: 'Clients', user: req.session.user, clients });
});

// New client form
router.get('/clients/new', (req, res) => {
  res.render('admin/client-detail', {
    title: 'New Client',
    user: req.session.user,
    client: null,
    clientUser: null,
    serviceTypes: [],
    requests: [],
    error: null
  });
});

// Create client
router.post('/clients', async (req, res) => {
  const { name, email, password, company_name } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const userResult = await db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [name, email, hash, 'client']
    );
    await db.run(
      'INSERT INTO clients (user_id, company_name) VALUES ($1, $2)',
      [userResult.lastID, company_name]
    );
    res.redirect('/admin/clients');
  } catch (err) {
    console.error('Create client error:', err);
    res.render('admin/client-detail', {
      title: 'New Client',
      user: req.session.user,
      client: null,
      clientUser: null,
      serviceTypes: [],
      requests: [],
      error: err.message.includes('UNIQUE') ? 'Email already exists' : 'Failed to create client'
    });
  }
});

// Client detail
router.get('/clients/:id', async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!client) return res.redirect('/admin/clients');

  const clientUser = await db.get('SELECT * FROM users WHERE id = $1', [client.user_id]);
  const serviceTypes = await db.query('SELECT * FROM service_types WHERE client_id = $1 ORDER BY name', [client.id]);
  const requests = await db.query(`
    SELECT sr.*, st.name as service_type_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.client_id = $1
    ORDER BY sr.created_at DESC
  `, [client.id]);

  res.render('admin/client-detail', {
    title: client.company_name,
    user: req.session.user,
    client,
    clientUser,
    serviceTypes,
    requests,
    error: null
  });
});

// Add service type
router.post('/clients/:id/service-types', async (req, res) => {
  await db.run(
    'INSERT INTO service_types (client_id, name) VALUES ($1, $2)',
    [req.params.id, req.body.name]
  );
  res.redirect(`/admin/clients/${req.params.id}`);
});

// Delete service type
router.delete('/clients/:id/service-types/:stid', async (req, res) => {
  await db.run('DELETE FROM service_types WHERE id = $1 AND client_id = $2', [req.params.stid, req.params.id]);
  res.json({ ok: true });
});

// Delete client
router.delete('/clients/:id', async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (client) {
    await db.run('DELETE FROM clients WHERE id = $1', [req.params.id]);
    await db.run('DELETE FROM users WHERE id = $1', [client.user_id]);
  }
  res.json({ ok: true });
});

// All requests
router.get('/requests', async (req, res) => {
  const { status, client_id, urgency } = req.query;
  let sql = `
    SELECT sr.*, c.company_name, st.name as service_type_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE 1=1
  `;
  const params = [];
  let i = 1;

  if (status) { sql += ` AND sr.status = $${i++}`; params.push(status); }
  if (client_id) { sql += ` AND sr.client_id = $${i++}`; params.push(client_id); }
  if (urgency) { sql += ` AND sr.urgency = $${i++}`; params.push(urgency); }
  sql += ' ORDER BY sr.created_at DESC';

  const requests = await db.query(sql, params);
  const clients = await db.query('SELECT id, company_name FROM clients ORDER BY company_name');

  res.render('admin/requests', {
    title: 'All Requests',
    user: req.session.user,
    requests,
    clients,
    filters: { status, client_id, urgency }
  });
});

// Request detail
router.get('/requests/:id', async (req, res) => {
  const request = await db.get(`
    SELECT sr.*, c.company_name, st.name as service_type_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.id = $1
  `, [req.params.id]);
  if (!request) return res.redirect('/admin/requests');

  const attachments = await db.query(
    'SELECT * FROM attachments WHERE service_request_id = $1',
    [req.params.id]
  );

  res.render('admin/request-detail', {
    title: `Request #${request.id}`,
    user: req.session.user,
    request,
    attachments
  });
});

// Update request status
router.post('/requests/:id/status', async (req, res) => {
  const { status, admin_notes } = req.body;
  await db.run(
    'UPDATE service_requests SET status = $1, admin_notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [status, admin_notes, req.params.id]
  );
  res.redirect(`/admin/requests/${req.params.id}`);
});

module.exports = router;
