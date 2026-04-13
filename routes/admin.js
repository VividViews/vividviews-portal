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
  const avgRating = await db.get('SELECT AVG(rating) as avg, COUNT(*) as count FROM request_ratings');
  const pipeline = await db.get("SELECT COALESCE(SUM(value), 0) as total FROM projects WHERE status = 'active'");

  let pendingEmergencies = 0;
  try {
    const pe = await db.get("SELECT COUNT(*) as count FROM emergency_requests WHERE status = 'pending'");
    pendingEmergencies = parseInt(pe.count) || 0;
  } catch (e) { /* table might not exist yet */ }

  const recentRequests = await db.query(`
    SELECT sr.*, c.company_name, st.name as service_type_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    ORDER BY sr.created_at DESC
    LIMIT 10
  `);

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
      pipeline: pipeline ? parseFloat(pipeline.total) || 0 : 0,
      pendingEmergencies
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
router.get('/clients/new', async (req, res) => {
  const clientTypes = await db.query('SELECT * FROM client_types ORDER BY name');
  res.render('admin/client-detail', {
    title: 'New Client',
    user: req.session.user,
    client: null,
    clientUser: null,
    clientUsers: [],
    serviceTypes: [],
    requests: [],
    brands: [],
    notes: [],
    sites: [],
    projects: [],
    clientTypes,
    error: null
  });
});

// Create client
router.post('/clients', async (req, res) => {
  const { name, email, password, company_name, client_type_id } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const userResult = await db.get(
      "INSERT INTO users (name, email, password_hash, role, access_level) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [name, email, hash, 'client', 'owner']
    );
    const clientType = client_type_id ? parseInt(client_type_id) : null;
    await db.get(
      'INSERT INTO clients (user_id, company_name, client_type_id) VALUES ($1, $2, $3) RETURNING id',
      [userResult.id, company_name, clientType]
    );
    res.redirect('/admin/clients');
  } catch (err) {
    console.error('Create client error:', err);
    const clientTypes = await db.query('SELECT * FROM client_types ORDER BY name');
    res.render('admin/client-detail', {
      title: 'New Client',
      user: req.session.user,
      client: null,
      clientUser: null,
      clientUsers: [],
      serviceTypes: [],
      requests: [],
      brands: [],
      notes: [],
      sites: [],
      projects: [],
      clientTypes,
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

  const brands = await db.query('SELECT * FROM carwash_brands WHERE client_id = $1 ORDER BY brand_name', [client.id]);
  for (const brand of brands) {
    brand.sites = await db.query('SELECT * FROM carwash_sites WHERE brand_id = $1 ORDER BY site_name', [brand.id]);
  }

  const notes = await db.query('SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC', [client.id]);
  const sites = await db.query('SELECT * FROM client_sites WHERE client_id = $1 ORDER BY site_name', [client.id]);
  const clientTypes = await db.query('SELECT * FROM client_types ORDER BY name');
  const projects = await db.query('SELECT * FROM projects WHERE client_id = $1 ORDER BY created_at DESC', [client.id]);

  // Get all users for this client (owner + additional site users)
  const clientUsers = await db.query(`
    SELECT u.*, cs.site_name
    FROM users u
    LEFT JOIN client_sites cs ON u.site_id = cs.id
    WHERE u.id = $1 OR (u.role = 'client' AND u.site_id IN (SELECT id FROM client_sites WHERE client_id = $2))
    ORDER BY u.created_at ASC
  `, [client.user_id, client.id]);

  // Also get users linked to this client via access_level who aren't the primary user
  // We need a broader query: find all client-role users whose clientId maps to this client
  // For now, the primary user + any users with site_id pointing to this client's sites

  const renderData = {
    title: client.company_name,
    user: req.session.user,
    client,
    clientUser,
    clientUsers,
    serviceTypes,
    requests,
    brands,
    notes,
    sites,
    projects,
    clientTypes,
    error: null
  };
  try {
    res.render('admin/client-detail', renderData);
  } catch(renderErr) {
    console.error('[RENDER ERROR client-detail]', renderErr.message);
    console.error('[RENDER DATA KEYS]', Object.keys(renderData));
    console.error('[STACK]', renderErr.stack);
    res.status(500).send('<pre>' + renderErr.message + '</pre>');
  }
});

// Edit client form
router.get('/clients/:id/edit', async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!client) return res.redirect('/admin/clients');
  const clientUser = await db.get('SELECT * FROM users WHERE id = $1', [client.user_id]);
  const clientTypes = await db.query('SELECT * FROM client_types ORDER BY name');
  res.render('admin/client-edit', {
    title: 'Edit ' + client.company_name,
    user: req.session.user,
    client,
    clientUser,
    clientTypes,
    error: null
  });
});

// Save client edits
router.post('/clients/:id/edit', async (req, res) => {
  const { company_name, client_type_id, name, email, password } = req.body;
  try {
    const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!client) return res.redirect('/admin/clients');
    
    await db.run('UPDATE clients SET company_name = $1, client_type_id = $2 WHERE id = $3',
      [company_name, client_type_id ? parseInt(client_type_id) : null, req.params.id]);

    await db.run('UPDATE users SET name = $1, email = $2 WHERE id = $3', [name, email, client.user_id]);

    if (password && password.trim().length >= 6) {
      const hash = await bcrypt.hash(password.trim(), 10);
      await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, client.user_id]);
    }
    res.redirect(`/admin/clients/${req.params.id}`);
  } catch (err) {
    console.error('Edit client error:', err);
    const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const clientUser = await db.get('SELECT * FROM users WHERE id = $1', [client.user_id]);
    const clientTypes = await db.query('SELECT * FROM client_types ORDER BY name');
    res.render('admin/client-edit', {
      title: 'Edit ' + client.company_name,
      user: req.session.user,
      client,
      clientUser,
      clientTypes,
      error: err.message
    });
  }
});

// Add user to client
router.post('/clients/:id/users', async (req, res) => {
  const { name, email, password, access_level, site_id } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.get(
      "INSERT INTO users (name, email, password_hash, role, access_level, site_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [name, email, hash, 'client', access_level || 'site', site_id ? parseInt(site_id) : null]
    );
    res.redirect(`/admin/clients/${req.params.id}`);
  } catch (err) {
    console.error('Add user error:', err);
    res.redirect(`/admin/clients/${req.params.id}`);
  }
});

// Delete user from client
router.delete('/clients/:id/users/:uid', async (req, res) => {
  // Don't allow deleting the primary client user
  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (client && parseInt(req.params.uid) !== client.user_id) {
    await db.run('DELETE FROM users WHERE id = $1', [req.params.uid]);
  }
  res.json({ ok: true });
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
  const { name, default_urgency } = req.body;
  await db.run(
    'INSERT INTO service_types (client_id, name, default_urgency) VALUES ($1, $2, $3)',
    [req.params.id, name, default_urgency || 'medium']
  );
  res.redirect(`/admin/clients/${req.params.id}`);
});

// Delete service type
router.delete('/clients/:id/service-types/:stid', async (req, res) => {
  await db.run('DELETE FROM service_types WHERE id = $1 AND client_id = $2', [req.params.stid, req.params.id]);
  res.json({ ok: true });
});

// ============ Client Sites ============

router.post('/clients/:id/sites', async (req, res) => {
  const { site_name, address, city, state, zip, site_manager_name, site_manager_phone, site_manager_email } = req.body;
  await db.run(
    'INSERT INTO client_sites (client_id, site_name, address, city, state, zip, site_manager_name, site_manager_phone, site_manager_email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [req.params.id, site_name, address || '', city || '', state || '', zip || '', site_manager_name || '', site_manager_phone || '', site_manager_email || '']
  );
  res.redirect(`/admin/clients/${req.params.id}`);
});

router.get('/clients/:id/sites/:sid', async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!client) return res.redirect('/admin/clients');
  const site = await db.get('SELECT * FROM client_sites WHERE id = $1 AND client_id = $2', [req.params.sid, req.params.id]);
  if (!site) return res.redirect(`/admin/clients/${req.params.id}`);

  const requests = await db.query(`
    SELECT sr.*, st.name as service_type_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.site_id = $1
    ORDER BY sr.created_at DESC
  `, [site.id]);

  const openCount = requests.filter(r => r.status === 'submitted' || r.status === 'in_review').length;
  const progressCount = requests.filter(r => r.status === 'in_progress').length;
  const completeCount = requests.filter(r => r.status === 'complete').length;

  res.render('admin/site-detail', {
    title: site.site_name,
    user: req.session.user,
    client,
    site,
    requests,
    stats: { open: openCount, inProgress: progressCount, complete: completeCount }
  });
});

router.post('/clients/:id/sites/:sid', async (req, res) => {
  const { site_name, address, city, state, zip, site_manager_name, site_manager_phone, site_manager_email } = req.body;
  await db.run(
    'UPDATE client_sites SET site_name=$1, address=$2, city=$3, state=$4, zip=$5, site_manager_name=$6, site_manager_phone=$7, site_manager_email=$8 WHERE id=$9 AND client_id=$10',
    [site_name, address||'', city||'', state||'', zip||'', site_manager_name||'', site_manager_phone||'', site_manager_email||'', req.params.sid, req.params.id]
  );
  res.redirect(`/admin/clients/${req.params.id}/sites/${req.params.sid}`);
});

router.delete('/clients/:id/sites/:sid', async (req, res) => {
  await db.run('DELETE FROM client_sites WHERE id = $1 AND client_id = $2', [req.params.sid, req.params.id]);
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

// ============ All Requests ============

router.get('/requests', async (req, res) => {
  const { status, client_id, urgency, site_id } = req.query;
  let sql = `
    SELECT sr.*, c.company_name, st.name as service_type_name,
      cs.site_name
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE 1=1
  `;
  const params = [];
  let i = 1;

  if (status) { sql += ` AND sr.status = $${i++}`; params.push(status); }
  if (client_id) { sql += ` AND sr.client_id = $${i++}`; params.push(client_id); }
  if (urgency) { sql += ` AND sr.urgency = $${i++}`; params.push(urgency); }
  if (site_id) { sql += ` AND sr.site_id = $${i++}`; params.push(site_id); }
  sql += ' ORDER BY sr.created_at DESC';

  const requests = await db.query(sql, params);
  const clients = await db.query('SELECT id, company_name FROM clients ORDER BY company_name');
  const allSites = await db.query('SELECT id, site_name FROM client_sites ORDER BY site_name');

  res.render('admin/requests', {
    title: 'All Requests',
    user: req.session.user,
    requests,
    clients,
    allSites,
    filters: { status, client_id, urgency, site_id }
  });
});

// Request detail
router.get('/requests/:id', async (req, res) => {
  const request = await db.get(`
    SELECT sr.*, c.company_name, u.name as contact_name, u.email as contact_email,
      st.name as service_type_name,
      cs.site_name, cs.address as site_address, cs.city as site_city, cs.state as site_state
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN users u ON c.user_id = u.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
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

  let emergency = null;
  try {
    emergency = await db.get('SELECT * FROM emergency_requests WHERE service_request_id = $1', [req.params.id]);
  } catch (e) { /* table might not exist */ }

  res.render('admin/request-detail', {
    title: `Request #${request.id}`,
    user: req.session.user,
    request,
    attachments,
    comments,
    rating,
    emergency
  });
});

// Delete request
router.post('/requests/:id/delete', async (req, res) => {
  await db.run('DELETE FROM emergency_requests WHERE service_request_id = $1', [req.params.id]);
  await db.run('DELETE FROM request_ratings WHERE service_request_id = $1', [req.params.id]);
  await db.run('DELETE FROM request_comments WHERE service_request_id = $1', [req.params.id]);
  await db.run('DELETE FROM attachments WHERE service_request_id = $1', [req.params.id]);
  await db.run('DELETE FROM service_requests WHERE id = $1', [req.params.id]);
  res.redirect('/admin/requests');
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

// ============ Employees ============

router.get('/employees', async (req, res) => {
  const employees = await db.query(`
    SELECT e.*,
      (SELECT COUNT(*) FROM employee_assignments WHERE employee_id = e.id) as assignment_count
    FROM employees e
    ORDER BY e.created_at DESC
  `);
  res.render('admin/employees', {
    title: 'Employees',
    user: req.session.user,
    employees
  });
});

router.get('/employees/new', (req, res) => {
  res.render('admin/employee-detail', {
    title: 'New Employee',
    user: req.session.user,
    employee: null,
    assignments: [],
    timeLogs: [],
    openRequests: [],
    clients: [],
    error: null
  });
});

router.post('/employees', async (req, res) => {
  const { name, email, password, role_name, hourly_rate } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.get(
      'INSERT INTO employees (name, email, password_hash, role_name, hourly_rate, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, email, hash, role_name || 'Technician', parseFloat(hourly_rate) || 0, 'active']
    );
    res.redirect(`/admin/employees/${result.id}`);
  } catch (err) {
    console.error('Create employee error:', err);
    res.render('admin/employee-detail', {
      title: 'New Employee',
      user: req.session.user,
      employee: null,
      assignments: [],
      timeLogs: [],
      openRequests: [],
      clients: [],
      error: err.message.includes('UNIQUE') ? 'Email already exists' : 'Failed to create employee'
    });
  }
});

router.get('/employees/:id', async (req, res) => {
  const employee = await db.get('SELECT * FROM employees WHERE id = $1', [req.params.id]);
  if (!employee) return res.redirect('/admin/employees');

  const assignments = await db.query(`
    SELECT ea.*, c.company_name, cs.site_name
    FROM employee_assignments ea
    JOIN clients c ON ea.client_id = c.id
    LEFT JOIN client_sites cs ON ea.site_id = cs.id
    WHERE ea.employee_id = $1
    ORDER BY c.company_name
  `, [employee.id]);

  const timeLogs = await db.query(`
    SELECT etl.*, er.service_request_id
    FROM emergency_time_logs etl
    JOIN emergency_requests er ON etl.emergency_request_id = er.id
    WHERE etl.employee_id = $1
    ORDER BY etl.clocked_in_at DESC
    LIMIT 20
  `, [employee.id]);

  // Get open requests for assigned sites
  const assignedSiteIds = assignments.filter(a => a.site_id).map(a => a.site_id);
  const assignedClientIds = assignments.map(a => a.client_id);
  let openRequests = [];
  if (assignedClientIds.length > 0) {
    const placeholders = assignedClientIds.map((_, i) => `$${i + 1}`).join(',');
    openRequests = await db.query(`
      SELECT sr.*, c.company_name, st.name as service_type_name, cs.site_name
      FROM service_requests sr
      JOIN clients c ON sr.client_id = c.id
      JOIN service_types st ON sr.service_type_id = st.id
      LEFT JOIN client_sites cs ON sr.site_id = cs.id
      WHERE sr.client_id IN (${placeholders}) AND sr.status != 'complete'
      ORDER BY sr.created_at DESC
      LIMIT 20
    `, assignedClientIds);
  }

  const clients = await db.query('SELECT id, company_name FROM clients ORDER BY company_name');

  res.render('admin/employee-detail', {
    title: employee.name,
    user: req.session.user,
    employee,
    assignments,
    timeLogs,
    openRequests,
    clients,
    error: null
  });
});

router.post('/employees/:id/edit', async (req, res) => {
  const { name, role_name, hourly_rate } = req.body;
  await db.run(
    'UPDATE employees SET name = $1, role_name = $2, hourly_rate = $3 WHERE id = $4',
    [name, role_name, parseFloat(hourly_rate) || 0, req.params.id]
  );
  res.redirect(`/admin/employees/${req.params.id}`);
});

router.post('/employees/:id/approve', async (req, res) => {
  await db.run("UPDATE employees SET status = 'active' WHERE id = $1", [req.params.id]);
  res.redirect(`/admin/employees/${req.params.id}`);
});

router.post('/employees/:id/deactivate', async (req, res) => {
  await db.run("UPDATE employees SET status = 'inactive' WHERE id = $1", [req.params.id]);
  res.redirect(`/admin/employees/${req.params.id}`);
});

router.post('/employees/:id/assign', async (req, res) => {
  const { client_id, site_id } = req.body;
  try {
    await db.run(
      'INSERT INTO employee_assignments (employee_id, client_id, site_id) VALUES ($1, $2, $3)',
      [req.params.id, client_id, site_id || null]
    );
  } catch (err) {
    console.error('Assignment error:', err.message);
  }
  res.redirect(`/admin/employees/${req.params.id}`);
});

router.delete('/employees/:id/assign/:aid', async (req, res) => {
  await db.run('DELETE FROM employee_assignments WHERE id = $1 AND employee_id = $2', [req.params.aid, req.params.id]);
  res.json({ ok: true });
});

router.delete('/employees/:id', async (req, res) => {
  await db.run('DELETE FROM employees WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ Emergency Queue ============

router.get('/emergency', async (req, res) => {
  const pending = await db.query(`
    SELECT er.*, sr.description, sr.client_id, sr.service_type_id,
      c.company_name, st.name as service_type_name, cs.site_name,
      sr.id as request_id
    FROM emergency_requests er
    JOIN service_requests sr ON er.service_request_id = sr.id
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE er.status = 'pending'
    ORDER BY er.created_at ASC
  `);

  const active = await db.query(`
    SELECT er.*, sr.description, sr.client_id,
      c.company_name, st.name as service_type_name, cs.site_name,
      sr.id as request_id, emp.name as employee_name
    FROM emergency_requests er
    JOIN service_requests sr ON er.service_request_id = sr.id
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    LEFT JOIN employees emp ON er.dispatched_employee_id = emp.id
    WHERE er.status IN ('approved', 'dispatched')
    ORDER BY er.created_at ASC
  `);

  const completed = await db.query(`
    SELECT er.*, sr.description,
      c.company_name, st.name as service_type_name, cs.site_name,
      sr.id as request_id, emp.name as employee_name
    FROM emergency_requests er
    JOIN service_requests sr ON er.service_request_id = sr.id
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    LEFT JOIN employees emp ON er.dispatched_employee_id = emp.id
    WHERE er.status = 'complete'
    ORDER BY er.created_at DESC
    LIMIT 20
  `);

  const employees = await db.query("SELECT id, name, role_name FROM employees WHERE status = 'active' ORDER BY name");

  res.render('admin/emergency', {
    title: 'Emergency Queue',
    user: req.session.user,
    pending,
    active,
    completed,
    employees
  });
});

router.post('/emergency/:eid/approve', async (req, res) => {
  const { dispatched_employee_id, base_fee } = req.body;
  await db.run(
    'UPDATE emergency_requests SET status = $1, dispatched_employee_id = $2, base_fee = $3, approved_by = $4, approved_at = CURRENT_TIMESTAMP WHERE id = $5',
    ['approved', dispatched_employee_id || null, parseFloat(base_fee) || 0, req.session.user.id, req.params.eid]
  );

  const er = await db.get('SELECT * FROM emergency_requests WHERE id = $1', [req.params.eid]);
  if (er) {
    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [er.service_request_id, 'Admin', 'admin', '✅ Emergency approved and employee dispatched', 'status_change']
    );
  }

  res.redirect('/admin/emergency');
});

router.post('/emergency/:eid/complete', async (req, res) => {
  await db.run("UPDATE emergency_requests SET status = 'complete' WHERE id = $1", [req.params.eid]);

  const er = await db.get('SELECT * FROM emergency_requests WHERE id = $1', [req.params.eid]);
  if (er) {
    // Auto-generate invoice
    const timeLogs = await db.query('SELECT * FROM emergency_time_logs WHERE emergency_request_id = $1', [req.params.eid]);
    let totalMinutes = 0;
    for (const log of timeLogs) {
      totalMinutes += log.total_minutes || 0;
    }
    const totalHours = totalMinutes / 60;
    const employee = er.dispatched_employee_id
      ? await db.get('SELECT * FROM employees WHERE id = $1', [er.dispatched_employee_id])
      : null;
    const hourlyRate = employee ? parseFloat(employee.hourly_rate) || 0 : 0;
    const laborCost = totalHours * hourlyRate;
    const baseFee = parseFloat(er.base_fee) || 0;
    const totalAmount = baseFee + laborCost;

    await db.run(
      'INSERT INTO emergency_invoices (emergency_request_id, base_fee, hourly_rate, total_hours, labor_cost, total_amount) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.params.eid, baseFee, hourlyRate, totalHours, laborCost, totalAmount]
    );

    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [er.service_request_id, 'Admin', 'admin', `🏁 Emergency completed. Invoice: $${totalAmount.toFixed(2)}`, 'status_change']
    );
  }

  res.redirect('/admin/emergency');
});

// ============ Settings ============

router.get('/settings', async (req, res) => {
  const clientTypes = await db.query('SELECT * FROM client_types ORDER BY name');
  res.render('admin/settings', {
    title: 'Settings',
    user: req.session.user,
    clientTypes
  });
});

router.post('/settings/client-types', async (req, res) => {
  const { name } = req.body;
  if (name && name.trim()) {
    try {
      await db.run('INSERT INTO client_types (name) VALUES ($1)', [name.trim()]);
    } catch (err) {
      console.error('Add client type error:', err.message);
    }
  }
  res.redirect('/admin/settings');
});

router.delete('/settings/client-types/:id', async (req, res) => {
  // Check if any clients use this type
  const usage = await db.get('SELECT COUNT(*) as count FROM clients WHERE client_type_id = $1', [req.params.id]);
  if (parseInt(usage.count) > 0) {
    return res.status(400).json({ error: 'Cannot delete: clients are using this type' });
  }
  await db.run('DELETE FROM client_types WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
