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

// Client dashboard
router.get('/', async (req, res) => {
  const clientId = req.session.user.clientId;

  const submitted = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status = 'submitted'", [clientId]);
  const inReview = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status = 'in_review'", [clientId]);
  const inProgress = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status = 'in_progress'", [clientId]);
  const complete = await db.query("SELECT COUNT(*) as count FROM service_requests WHERE client_id = $1 AND status = 'complete'", [clientId]);

  const requests = await db.query(`
    SELECT sr.*, st.name as service_type_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.client_id = $1
    ORDER BY sr.created_at DESC
  `, [clientId]);

  res.render('portal/dashboard', {
    title: 'Dashboard',
    user: req.session.user,
    stats: {
      submitted: submitted[0].count,
      inReview: inReview[0].count,
      inProgress: inProgress[0].count,
      complete: complete[0].count
    },
    requests
  });
});

// File Vault
router.get('/files', async (req, res) => {
  const clientId = req.session.user.clientId;
  const requests = await db.query(`
    SELECT sr.id, sr.description, st.name as service_type_name, sr.created_at
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.client_id = $1
    ORDER BY sr.created_at DESC
  `, [clientId]);

  // Get attachments for each request
  for (const r of requests) {
    r.attachments = await db.query(
      'SELECT * FROM attachments WHERE service_request_id = $1 ORDER BY created_at DESC',
      [r.id]
    );
  }

  // Filter to only requests with attachments
  const requestsWithFiles = requests.filter(r => r.attachments.length > 0);

  res.render('portal/files', {
    title: 'File Vault',
    user: req.session.user,
    requests: requestsWithFiles
  });
});

// New request form
router.get('/requests/new', async (req, res) => {
  const serviceTypes = await db.query(
    'SELECT * FROM service_types WHERE client_id = $1 ORDER BY name',
    [req.session.user.clientId]
  );
  res.render('portal/new-request', {
    title: 'New Request',
    user: req.session.user,
    serviceTypes,
    error: null
  });
});

// Submit request
router.post('/requests', upload.array('files', 5), async (req, res) => {
  const { service_type_id, description, urgency } = req.body;
  const clientId = req.session.user.clientId;

  try {
    const st = await db.get(
      'SELECT * FROM service_types WHERE id = $1 AND client_id = $2',
      [service_type_id, clientId]
    );
    if (!st) throw new Error('Invalid service type');

    const result = await db.run(
      'INSERT INTO service_requests (client_id, service_type_id, description, urgency) VALUES ($1, $2, $3, $4)',
      [clientId, service_type_id, description, urgency]
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

    res.redirect('/portal');
  } catch (err) {
    console.error('Submit request error:', err);
    const serviceTypes = await db.query(
      'SELECT * FROM service_types WHERE client_id = $1 ORDER BY name',
      [clientId]
    );
    res.render('portal/new-request', {
      title: 'New Request',
      user: req.session.user,
      serviceTypes,
      error: 'Failed to submit request'
    });
  }
});

// Request detail
router.get('/requests/:id', async (req, res) => {
  const request = await db.get(`
    SELECT sr.*, st.name as service_type_name
    FROM service_requests sr
    JOIN service_types st ON sr.service_type_id = st.id
    WHERE sr.id = $1 AND sr.client_id = $2
  `, [req.params.id, req.session.user.clientId]);

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
    rating
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

module.exports = router;
