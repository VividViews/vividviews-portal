const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const db = require('../utils/db');
const { requireAdmin } = require('../middleware/auth');
const { sendStatusUpdate } = require('../utils/email');
const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAdmin);

// Dashboard
router.get('/', async (req, res) => {
  const clients = await db.query('SELECT COUNT(*) as count FROM clients');
  const submitted = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'submitted'");
  const inProgress = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'in_progress'");
  const inReview = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'in_review'");
  const complete = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE status = 'complete'");

  // Average rating
  const avgRating = await db.get('SELECT AVG(rating) as avg, COUNT(*) as count FROM request_ratings');

  // Pipeline value
  const pipeline = await db.get("SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE status = 'active'");

  const recentRequests = await db.query(`
    SELECT sr.*, c.company_name, st.name as service_type_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    ORDER BY sr.created_at DESC
    LIMIT 10
  `);

  // Recent activity: last 10 comments/status changes
  const recentActivity = await db.query(`
    SELECT rc.*, c.company_name
    FROM request_comments rc
    JOIN service_requests sr ON rc.service_request_id = sr.id
    JOIN clients c ON sr.client_id = c.id
    ORDER BY rc.created_at DESC
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
      complete: complete[0].count,
      avgRating: avgRating ? (parseFloat(avgRating.avg) || 0) : 0,
      ratingCount: avgRating ? (parseInt(avgRating.count) || 0) : 0,
      pipeline: pipeline ? parseFloat(pipeline.total) || 0 : 0
    },
    recentRequests,
    recentActivity
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
    brands: [],
    notes: [],
    error: null
  });
});

// Create client
router.post('/clients', async (req, res) => {
  const { name, email, password, company_name } = req.body;
  try {
    const { client_type } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const userResult = await db.get(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, hash, 'client']
    );
    await db.get(
      'INSERT INTO clients (user_id, company_name, client_type) VALUES ($1, $2, $3) RETURNING id',
      [userResult.id, company_name, client_type || 'standard']
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
      brands: [],
      notes: [],
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

  // Fetch car wash brands and sites
  const brands = await db.query('SELECT * FROM carwash_brands WHERE client_id = $1 ORDER BY brand_name', [client.id]);
  for (const brand of brands) {
    brand.sites = await db.query('SELECT * FROM carwash_sites WHERE brand_id = $1 ORDER BY site_name', [brand.id]);
  }

  // Fetch private notes
  const notes = await db.query('SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC', [client.id]);

  res.render('admin/client-detail', {
    title: client.company_name,
    user: req.session.user,
    client,
    clientUser,
    serviceTypes,
    requests,
    brands,
    notes,
    error: null
  });
});

// Add private note to client
router.post('/clients/:id/notes', async (req, res) => {
  const { note } = req.body;
  if (note && note.trim()) {
    await db.run(
      'INSERT INTO client_notes (client_id, note) VALUES ($1, $2)',
      [req.params.id, note.trim()]
    );
  }
  res.redirect(`/admin/clients/${req.params.id}`);
});

// Delete private note
router.delete('/clients/:id/notes/:nid', async (req, res) => {
  await db.run('DELETE FROM client_notes WHERE id = $1 AND client_id = $2', [req.params.nid, req.params.id]);
  res.json({ ok: true });
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
    SELECT sr.*, c.company_name, u.name as contact_name, u.email as contact_email, st.name as service_type_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN users u ON c.user_id = u.id
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.id = $1
  `, [req.params.id]);
  if (!request) return res.redirect('/admin/requests');

  const attachments = await db.query(
    'SELECT * FROM attachments WHERE service_request_id = $1',
    [req.params.id]
  );

  const comments = await db.query(
    'SELECT * FROM request_comments WHERE service_request_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );

  const rating = await db.get(
    'SELECT * FROM request_ratings WHERE service_request_id = $1',
    [req.params.id]
  );

  res.render('admin/request-detail', {
    title: `Request #${request.id}`,
    user: req.session.user,
    request,
    attachments,
    comments,
    rating
  });
});

// Update request status (with email notification)
router.post('/requests/:id/status', async (req, res) => {
  const { status, admin_notes } = req.body;
  await db.run(
    'UPDATE service_requests SET status = $1, admin_notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [status, admin_notes, req.params.id]
  );
  let commentText = `Status changed to ${status.replace('_', ' ')}`;
  if (admin_notes) commentText += ` — ${admin_notes}`;
  await db.run(
    'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
    [req.params.id, 'Admin', 'admin', commentText, 'status_change']
  );

  // Send email notification
  try {
    const request = await db.get(`
      SELECT sr.*, u.email as contact_email, u.name as contact_name
      FROM service_requests sr
      JOIN clients c ON sr.client_id = c.id
      JOIN users u ON c.user_id = u.id
      WHERE sr.id = $1
    `, [req.params.id]);
    if (request) {
      await sendStatusUpdate(request.contact_email, request.contact_name, req.params.id, status, admin_notes);
    }
  } catch (err) {
    console.error('Email notification error:', err.message);
  }

  res.redirect(`/admin/requests/${req.params.id}`);
});

// Add comment
router.post('/requests/:id/comment', async (req, res) => {
  const { comment } = req.body;
  if (comment && comment.trim()) {
    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, 'Admin', 'admin', comment.trim(), 'comment']
    );
  }
  res.redirect(`/admin/requests/${req.params.id}`);
});

// Upload file to existing request
router.post('/requests/:id/upload', upload.single('file'), async (req, res) => {
  if (req.file) {
    await db.run(
      'INSERT INTO attachments (service_request_id, filename, original_name, mimetype) VALUES ($1, $2, $3, $4)',
      [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype]
    );
    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, 'Admin', 'admin', `File uploaded: ${req.file.originalname}`, 'file_upload']
    );
  }
  res.redirect(`/admin/requests/${req.params.id}`);
});

// ============ Revenue Tracker ============

router.get('/revenue', async (req, res) => {
  const projects = await db.query(`
    SELECT p.*, c.company_name
    FROM projects p
    JOIN clients c ON p.client_id = c.id
    ORDER BY p.created_at DESC
  `);
  const clients = await db.query('SELECT id, company_name FROM clients ORDER BY company_name');

  const totalPipeline = await db.get("SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE status = 'active'");
  const invoicedNotPaid = await db.get(
    db.type === 'pg'
      ? "SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE invoiced = TRUE AND paid = FALSE"
      : "SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE invoiced = 1 AND paid = 0"
  );
  const paidThisMonth = await db.get(
    db.type === 'pg'
      ? "SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE paid = TRUE AND updated_at >= date_trunc('month', CURRENT_DATE)"
      : "SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE paid = 1 AND updated_at >= date('now', 'start of month')"
  );
  const activeCount = await db.get("SELECT COUNT(*) as count FROM projects WHERE status = 'active'");

  res.render('admin/revenue', {
    title: 'Revenue',
    user: req.session.user,
    projects,
    clients,
    stats: {
      pipeline: parseFloat(totalPipeline.total) || 0,
      invoicedNotPaid: parseFloat(invoicedNotPaid.total) || 0,
      paidThisMonth: parseFloat(paidThisMonth.total) || 0,
      activeProjects: parseInt(activeCount.count) || 0
    }
  });
});

router.post('/revenue/projects', async (req, res) => {
  const { client_id, name, value } = req.body;
  await db.run(
    'INSERT INTO projects (client_id, name, value) VALUES ($1, $2, $3)',
    [client_id, name, parseFloat(value) || 0]
  );
  res.redirect('/admin/revenue');
});

router.post('/revenue/projects/:id/status', async (req, res) => {
  const { status, invoiced, paid } = req.body;
  if (status) {
    await db.run('UPDATE projects SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, req.params.id]);
  }
  if (invoiced !== undefined) {
    const val = db.type === 'pg' ? (invoiced === '1' ? true : false) : (invoiced === '1' ? 1 : 0);
    await db.run('UPDATE projects SET invoiced = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [val, req.params.id]);
  }
  if (paid !== undefined) {
    const val = db.type === 'pg' ? (paid === '1' ? true : false) : (paid === '1' ? 1 : 0);
    await db.run('UPDATE projects SET paid = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [val, req.params.id]);
  }
  res.redirect('/admin/revenue');
});

router.delete('/revenue/projects/:id', async (req, res) => {
  await db.run('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ Car Wash Brands & Sites ============

router.get('/clients/:id/brands', async (req, res) => {
  const brands = await db.query('SELECT * FROM carwash_brands WHERE client_id = $1 ORDER BY brand_name', [req.params.id]);
  for (const brand of brands) {
    brand.sites = await db.query('SELECT * FROM carwash_sites WHERE brand_id = $1 ORDER BY site_name', [brand.id]);
  }
  res.json(brands);
});

router.post('/clients/:id/brands', async (req, res) => {
  const { brand_name } = req.body;
  await db.get(
    'INSERT INTO carwash_brands (client_id, brand_name) VALUES ($1, $2) RETURNING id',
    [req.params.id, brand_name]
  );
  res.redirect(`/admin/clients/${req.params.id}`);
});

router.get('/clients/:id/brands/:bid', async (req, res) => {
  const brand = await db.get('SELECT * FROM carwash_brands WHERE id = $1 AND client_id = $2', [req.params.bid, req.params.id]);
  if (!brand) return res.redirect(`/admin/clients/${req.params.id}`);
  brand.sites = await db.query('SELECT * FROM carwash_sites WHERE brand_id = $1 ORDER BY site_name', [brand.id]);
  res.json(brand);
});

router.post('/clients/:id/brands/:bid/sites', async (req, res) => {
  const { site_name, address, city, state } = req.body;
  await db.get(
    'INSERT INTO carwash_sites (brand_id, site_name, address, city, state) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.params.bid, site_name, address || '', city || '', state || '']
  );
  res.redirect(`/admin/clients/${req.params.id}`);
});

router.post('/clients/:id/brands/:bid/sites/:sid/status', async (req, res) => {
  const site = await db.get('SELECT * FROM carwash_sites WHERE id = $1', [req.params.sid]);
  if (site) {
    const newStatus = site.status === 'active' ? 'inactive' : 'active';
    await db.run('UPDATE carwash_sites SET status = $1 WHERE id = $2', [newStatus, req.params.sid]);
  }
  res.redirect(`/admin/clients/${req.params.id}`);
});

router.delete('/clients/:id/brands/:bid', async (req, res) => {
  await db.run('DELETE FROM carwash_brands WHERE id = $1 AND client_id = $2', [req.params.bid, req.params.id]);
  res.json({ ok: true });
});

router.delete('/clients/:id/brands/:bid/sites/:sid', async (req, res) => {
  await db.run('DELETE FROM carwash_sites WHERE id = $1 AND brand_id = $2', [req.params.sid, req.params.bid]);
  res.json({ ok: true });
});

module.exports = router;
