const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../utils/db');
const { requireClient } = require('../middleware/auth');
const router = express.Router();

router.use(requireClient);

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Helper: build WHERE clause based on access level
function accessFilter(user) {
  if (user.accessLevel === 'site' && user.siteId) {
    return { clause: 'AND sr.site_id = $SITE', params: [user.siteId] };
  }
  return { clause: '', params: [] };
}

// Client dashboard
router.get('/', async (req, res) => {
  const clientId = req.session.user.clientId;
  const accessLevel = req.session.user.accessLevel || 'owner';
  const siteId = req.session.user.siteId;

  // Check onboarding
  try {
    const client = await db.get('SELECT onboarded FROM clients WHERE id = $1', [clientId]);
    const onboarded = client && (client.onboarded === true || client.onboarded === 1);
    if (!onboarded) {
      return res.redirect('/portal/welcome');
    }
  } catch (e) { /* ignore, proceed to dashboard */ }

  let siteFilter = '';
  const baseParams = [clientId];
  if (accessLevel === 'site' && siteId) {
    siteFilter = ' AND sr.site_id = $2';
    baseParams.push(siteId);
  }

  const countQuery = (status) => db.query(
    `SELECT COUNT(*) as count FROM service_requests sr WHERE sr.client_id = $1 AND sr.status = '${status}'${siteFilter}`,
    baseParams
  );

  const submitted = await countQuery('submitted');
  const inReview = await countQuery('in_review');
  const inProgress = await countQuery('in_progress');
  const complete = await countQuery('complete');

  const requests = await db.query(`
    SELECT sr.*, st.name as service_type_name, cs.site_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE sr.client_id = $1${siteFilter}
    ORDER BY sr.created_at DESC
  `, baseParams);

  // Get sites for owner/regional users
  let sites = [];
  if (accessLevel !== 'site') {
    sites = await db.query(`
      SELECT cs.*,
        (SELECT COUNT(*) FROM service_requests sr WHERE sr.site_id = cs.id AND sr.status != 'complete') as open_count
      FROM client_sites cs
      WHERE cs.client_id = $1
      ORDER BY cs.site_name
    `, [clientId]);
  }

  // Check for pending emergencies
  let pendingEmergencies = [];
  try {
    pendingEmergencies = await db.query(`
      SELECT er.*, sr.description, cs.site_name
      FROM emergency_requests er
      JOIN service_requests sr ON er.service_request_id = sr.id
      LEFT JOIN client_sites cs ON sr.site_id = cs.id
      WHERE sr.client_id = $1 AND er.status = 'pending'
    `, [clientId]);
  } catch (e) { /* table might not exist */ }

  // Completed this month
  let completedThisMonth = 0;
  try {
    const ctmQuery = db.type === 'pg'
      ? `SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status = 'complete' AND created_at >= date_trunc('month', NOW())`
      : `SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status = 'complete' AND created_at >= date('now', 'start of month')`;
    const ctm = await db.query(ctmQuery, [clientId]);
    completedThisMonth = parseInt(ctm[0].count) || 0;
  } catch (e) { /* ignore */ }

  // Fetch announcements
  let announcements = [];
  try {
    announcements = await db.query(
      "SELECT * FROM announcements WHERE target = 'all' OR target = $1 ORDER BY created_at DESC LIMIT 5",
      [String(clientId)]
    );
  } catch (e) { /* ignore */ }

  res.render('portal/dashboard', {
    title: 'Dashboard',
    user: req.session.user,
    stats: {
      submitted: submitted[0].count,
      inReview: inReview[0].count,
      inProgress: inProgress[0].count,
      complete: complete[0].count
    },
    requests,
    sites,
    pendingEmergencies,
    accessLevel,
    completedThisMonth,
    announcements,
    currentPath: req.path
  });
});

// Welcome / Onboarding
router.get('/welcome', async (req, res) => {
  res.render('portal/welcome', {
    title: 'Welcome',
    user: req.session.user,
    currentPath: req.path
  });
});

router.post('/welcome/complete', async (req, res) => {
  const clientId = req.session.user.clientId;
  const onboardedVal = db.type === 'pg' ? true : 1;
  await db.run('UPDATE clients SET onboarded = $1 WHERE id = $2', [onboardedVal, clientId]);
  res.redirect('/portal');
});

// File Vault
router.get('/files', async (req, res) => {
  const clientId = req.session.user.clientId;
  const accessLevel = req.session.user.accessLevel || 'owner';
  const siteId = req.session.user.siteId;

  let siteFilter = '';
  const params = [clientId];
  if (accessLevel === 'site' && siteId) {
    siteFilter = ' AND sr.site_id = $2';
    params.push(siteId);
  }

  const requests = await db.query(`
    SELECT sr.id, sr.description, st.name as service_type_name, sr.created_at
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.client_id = $1${siteFilter}
    ORDER BY sr.created_at DESC
  `, params);

  for (const r of requests) {
    r.attachments = await db.query(
      'SELECT * FROM attachments WHERE service_request_id = $1 ORDER BY created_at DESC',
      [r.id]
    );
  }

  const requestsWithFiles = requests.filter(r => r.attachments.length > 0);

  res.render('portal/files', {
    title: 'File Vault',
    user: req.session.user,
    requests: requestsWithFiles,
    currentPath: req.path
  });
});

// New request form
router.get('/requests/new', async (req, res) => {
  const clientId = req.session.user.clientId;
  const serviceTypes = await db.query(
    'SELECT * FROM service_types WHERE client_id = $1 ORDER BY name',
    [clientId]
  );

  // Get the user's site info
  let userSite = null;
  if (req.session.user.siteId) {
    userSite = await db.get('SELECT * FROM client_sites WHERE id = $1', [req.session.user.siteId]);
  }

  // Fetch templates
  let templates = [];
  try {
    templates = await db.query(
      'SELECT rt.*, st.name as service_type_name FROM request_templates rt LEFT JOIN service_types st ON rt.service_type_id = st.id WHERE rt.client_id = $1 ORDER BY rt.name',
      [clientId]
    );
  } catch (e) { /* ignore */ }

  res.render('portal/new-request', {
    title: 'New Request',
    user: req.session.user,
    serviceTypes,
    userSite,
    templates,
    error: null,
    currentPath: req.path
  });
});

// Submit request
router.post('/requests', upload.array('files', 5), async (req, res) => {
  const { service_type_id, description, is_emergency } = req.body;
  const clientId = req.session.user.clientId;
  const siteId = req.session.user.siteId || null;

  try {
    const st = await db.get(
      'SELECT * FROM service_types WHERE id = $1 AND client_id = $2',
      [service_type_id, clientId]
    );
    if (!st) throw new Error('Invalid service type');

    // Use preset urgency from service type
    const urgency = st.default_urgency || 'medium';
    const isEmergency = is_emergency === 'on' || is_emergency === '1';
    const emergencyVal = db.type === 'pg' ? isEmergency : (isEmergency ? 1 : 0);

    const result = await db.run(
      'INSERT INTO service_requests (client_id, service_type_id, description, urgency, site_id, is_emergency) VALUES ($1, $2, $3, $4, $5, $6)',
      [clientId, service_type_id, description, urgency, siteId, emergencyVal]
    );

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await db.run(
          'INSERT INTO attachments (service_request_id, filename, original_name, mimetype) VALUES ($1, $2, $3, $4)',
          [result.lastID, file.filename, file.originalname, file.mimetype]
        );
      }
    }

    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [result.lastID, 'System', 'system', `Request submitted by ${req.session.user.name}`, 'system']
    );

    // If emergency, create emergency_request record
    if (isEmergency) {
      await db.run(
        "INSERT INTO emergency_requests (service_request_id, status) VALUES ($1, 'pending')",
        [result.lastID]
      );
      await db.run(
        'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
        [result.lastID, 'System', 'system', '⚠️ Emergency request submitted — awaiting admin approval', 'system']
      );
    }

    res.redirect(`/portal/requests/${result.lastID}/confirmation`);
  } catch (err) {
    console.error('Submit request error:', err);
    const serviceTypes = await db.query(
      'SELECT * FROM service_types WHERE client_id = $1 ORDER BY name',
      [clientId]
    );
    let userSite = null;
    if (req.session.user.siteId) {
      userSite = await db.get('SELECT * FROM client_sites WHERE id = $1', [req.session.user.siteId]);
    }
    let templates = [];
    try {
      templates = await db.query(
        'SELECT rt.*, st.name as service_type_name FROM request_templates rt LEFT JOIN service_types st ON rt.service_type_id = st.id WHERE rt.client_id = $1 ORDER BY rt.name',
        [clientId]
      );
    } catch (e) { /* ignore */ }
    res.render('portal/new-request', {
      title: 'New Request',
      user: req.session.user,
      serviceTypes,
      userSite,
      templates,
      error: 'Failed to submit request',
      currentPath: '/portal/requests/new'
    });
  }
});

// Request confirmation
router.get('/requests/:id/confirmation', async (req, res) => {
  const clientId = req.session.user.clientId;
  const request = await db.get(`
    SELECT sr.*, st.name as service_type_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.id = $1 AND sr.client_id = $2
  `, [req.params.id, clientId]);

  if (!request) return res.redirect('/portal');

  res.render('portal/request-confirmation', {
    title: 'Request Submitted',
    user: req.session.user,
    request,
    currentPath: req.path
  });
});

// Request detail
router.get('/requests/:id', async (req, res) => {
  const clientId = req.session.user.clientId;
  const accessLevel = req.session.user.accessLevel || 'owner';
  const siteId = req.session.user.siteId;

  let siteFilter = '';
  const params = [req.params.id, clientId];
  if (accessLevel === 'site' && siteId) {
    siteFilter = ' AND sr.site_id = $3';
    params.push(siteId);
  }

  const request = await db.get(`
    SELECT sr.*, st.name as service_type_name, cs.site_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE sr.id = $1 AND sr.client_id = $2${siteFilter}
  `, params);

  if (!request) return res.redirect('/portal');

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

  res.render('portal/request-detail', {
    title: `Request #${request.id}`,
    user: req.session.user,
    request,
    attachments,
    comments,
    rating,
    currentPath: req.path
  });
});

// Submit rating
router.post('/requests/:id/rate', async (req, res) => {
  const request = await db.get(
    "SELECT id, status FROM service_requests WHERE id = $1 AND client_id = $2 AND status = 'complete'",
    [req.params.id, req.session.user.clientId]
  );
  if (!request) return res.redirect('/portal');

  const existing = await db.get(
    'SELECT id FROM request_ratings WHERE service_request_id = $1',
    [req.params.id]
  );
  if (existing) return res.redirect(`/portal/requests/${req.params.id}`);

  const { rating, feedback } = req.body;
  const ratingVal = parseInt(rating);
  if (ratingVal < 1 || ratingVal > 5) return res.redirect(`/portal/requests/${req.params.id}`);

  await db.run(
    'INSERT INTO request_ratings (service_request_id, rating, feedback) VALUES ($1, $2, $3)',
    [req.params.id, ratingVal, feedback || '']
  );

  res.redirect(`/portal/requests/${req.params.id}`);
});

// Client adds a comment
router.post('/requests/:id/comment', async (req, res) => {
  const request = await db.get(
    'SELECT id FROM service_requests WHERE id = $1 AND client_id = $2',
    [req.params.id, req.session.user.clientId]
  );
  if (!request) return res.redirect('/portal');

  const { comment } = req.body;
  if (comment && comment.trim()) {
    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, req.session.user.name, 'client', comment.trim(), 'comment']
    );
  }
  res.redirect(`/portal/requests/${req.params.id}`);
});

// Client uploads a file to existing request
router.post('/requests/:id/upload', upload.single('file'), async (req, res) => {
  const request = await db.get(
    'SELECT id FROM service_requests WHERE id = $1 AND client_id = $2',
    [req.params.id, req.session.user.clientId]
  );
  if (!request) return res.redirect('/portal');

  if (req.file) {
    await db.run(
      'INSERT INTO attachments (service_request_id, filename, original_name, mimetype) VALUES ($1, $2, $3, $4)',
      [req.params.id, req.file.filename, req.file.originalname, req.file.mimetype]
    );
    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, req.session.user.name, 'client', `File uploaded: ${req.file.originalname}`, 'file_upload']
    );
  }
  res.redirect(`/portal/requests/${req.params.id}`);
});

// Site-filtered requests (owner/regional only)
router.get('/sites/:site_id/requests', async (req, res) => {
  const clientId = req.session.user.clientId;
  const accessLevel = req.session.user.accessLevel || 'owner';

  if (accessLevel !== 'owner' && accessLevel !== 'regional') {
    return res.redirect('/portal');
  }

  const site = await db.get('SELECT * FROM client_sites WHERE id = $1 AND client_id = $2', [req.params.site_id, clientId]);
  if (!site) return res.redirect('/portal');

  const statusFilter = req.query.status || '';
  let filterClause = '';
  const params = [clientId, req.params.site_id];
  if (statusFilter && ['submitted', 'in_review', 'in_progress', 'complete'].includes(statusFilter)) {
    filterClause = ' AND sr.status = $3';
    params.push(statusFilter);
  }

  const requests = await db.query(`
    SELECT sr.*, st.name as service_type_name, cs.site_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE sr.client_id = $1 AND sr.site_id = $2${filterClause}
    ORDER BY sr.created_at DESC
  `, params);

  res.render('portal/site-requests', {
    title: `Site: ${site.site_name}`,
    user: req.session.user,
    site,
    requests,
    statusFilter,
    currentPath: req.path
  });
});

// ============ Notifications API ============

router.get('/notifications', async (req, res) => {
  try {
    const notifications = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.session.user.id]
    );
    res.json(notifications);
  } catch (e) {
    res.json([]);
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  const readVal = db.type === 'pg' ? true : 1;
  await db.run('UPDATE notifications SET read = $1 WHERE id = $2 AND user_id = $3', [readVal, req.params.id, req.session.user.id]);
  res.json({ ok: true });
});

router.post('/notifications/read-all', async (req, res) => {
  const readVal = db.type === 'pg' ? true : 1;
  await db.run('UPDATE notifications SET read = $1 WHERE user_id = $2', [readVal, req.session.user.id]);
  res.json({ ok: true });
});

// ============ Documents ============

router.get('/documents', async (req, res) => {
  const clientId = req.session.user.clientId;
  let documents = [];
  try {
    documents = await db.query(
      'SELECT * FROM client_documents WHERE client_id = $1 ORDER BY created_at DESC',
      [clientId]
    );
  } catch (e) { /* ignore */ }

  res.render('portal/documents', {
    title: 'Documents',
    user: req.session.user,
    documents,
    currentPath: req.path
  });
});

router.get('/documents/:did/download', async (req, res) => {
  const clientId = req.session.user.clientId;
  const doc = await db.get('SELECT * FROM client_documents WHERE id = $1 AND client_id = $2', [req.params.did, clientId]);
  if (!doc) return res.redirect('/portal/documents');
  const filePath = path.join(__dirname, '..', 'uploads', doc.filename);
  res.download(filePath, doc.original_name);
});

module.exports = router;
