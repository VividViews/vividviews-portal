const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../utils/db');
const { requireEmployee } = require('../middleware/auth');
const router = express.Router();

// ============ Auth (no middleware) ============

router.get('/login', (req, res) => {
  if (req.session.employee) return res.redirect('/employee');
  res.render('employee/login', { title: 'Employee Login', error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const employee = await db.get("SELECT * FROM employees WHERE email = $1 AND status = 'active'", [email]);
    if (!employee || !(await bcrypt.compare(password, employee.password_hash))) {
      return res.render('employee/login', { title: 'Employee Login', error: 'Invalid credentials or account not active' });
    }

    req.session.employee = {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role_name: employee.role_name,
      hourly_rate: parseFloat(employee.hourly_rate) || 0
    };

    res.redirect('/employee');
  } catch (err) {
    console.error('Employee login error:', err);
    res.render('employee/login', { title: 'Employee Login', error: 'Something went wrong' });
  }
});

router.post('/logout', (req, res) => {
  delete req.session.employee;
  req.session.save(() => {
    res.redirect('/employee/login');
  });
});

// ============ Protected routes ============

router.use(requireEmployee);

// Dashboard
router.get('/', async (req, res) => {
  const empId = req.session.employee.id;

  const assignments = await db.query(`
    SELECT ea.*, c.company_name, cs.site_name
    FROM employee_assignments ea
    JOIN clients c ON ea.client_id = c.id
    LEFT JOIN client_sites cs ON ea.site_id = cs.id
    WHERE ea.employee_id = $1
    ORDER BY c.company_name
  `, [empId]);

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

  let activeEmergencies = 0;
  try {
    const emergencyResult = await db.get(
      "SELECT COUNT(*) as count FROM emergency_requests WHERE dispatched_employee_id = $1 AND status IN ('approved', 'dispatched')",
      [empId]
    );
    activeEmergencies = parseInt(emergencyResult.count) || 0;
  } catch (e) { /* table might not exist */ }

  res.render('employee/dashboard', {
    title: 'Employee Dashboard',
    employee: req.session.employee,
    assignments,
    openRequests,
    stats: {
      assignedClients: [...new Set(assignedClientIds)].length,
      openRequests: openRequests.length,
      activeEmergencies
    }
  });
});

// Requests list
router.get('/requests', async (req, res) => {
  const empId = req.session.employee.id;
  const assignments = await db.query('SELECT client_id FROM employee_assignments WHERE employee_id = $1', [empId]);
  const clientIds = assignments.map(a => a.client_id);

  let requests = [];
  if (clientIds.length > 0) {
    const placeholders = clientIds.map((_, i) => `$${i + 1}`).join(',');
    requests = await db.query(`
      SELECT sr.*, c.company_name, st.name as service_type_name, cs.site_name
      FROM service_requests sr
      JOIN clients c ON sr.client_id = c.id
      JOIN service_types st ON sr.service_type_id = st.id
      LEFT JOIN client_sites cs ON sr.site_id = cs.id
      WHERE sr.client_id IN (${placeholders}) AND sr.status != 'complete'
      ORDER BY sr.created_at DESC
    `, clientIds);
  }

  res.render('employee/requests', {
    title: 'Open Requests',
    employee: req.session.employee,
    requests
  });
});

// Request detail
router.get('/requests/:id', async (req, res) => {
  const empId = req.session.employee.id;
  const assignments = await db.query('SELECT client_id FROM employee_assignments WHERE employee_id = $1', [empId]);
  const clientIds = assignments.map(a => a.client_id);

  const request = await db.get(`
    SELECT sr.*, c.company_name, st.name as service_type_name, cs.site_name, cs.address as site_address
    FROM service_requests sr
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE sr.id = $1
  `, [req.params.id]);

  if (!request || !clientIds.includes(request.client_id)) {
    return res.redirect('/employee/requests');
  }

  const comments = await db.query(
    'SELECT * FROM request_comments WHERE service_request_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );

  const attachments = await db.query(
    'SELECT * FROM attachments WHERE service_request_id = $1',
    [req.params.id]
  );

  res.render('employee/request-detail', {
    title: `Request #${request.id}`,
    employee: req.session.employee,
    request,
    comments,
    attachments
  });
});

// Add comment
router.post('/requests/:id/comment', async (req, res) => {
  const { comment } = req.body;
  if (comment && comment.trim()) {
    await db.run(
      'INSERT INTO request_comments (service_request_id, author_name, author_role, comment, comment_type) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, req.session.employee.name, 'employee', comment.trim(), 'comment']
    );
  }
  res.redirect(`/employee/requests/${req.params.id}`);
});

// Emergency
router.get('/emergency', async (req, res) => {
  const empId = req.session.employee.id;

  const emergencies = await db.query(`
    SELECT er.*, sr.description, sr.id as request_id,
      c.company_name, st.name as service_type_name,
      cs.site_name, cs.address as site_address, cs.city as site_city, cs.state as site_state
    FROM emergency_requests er
    JOIN service_requests sr ON er.service_request_id = sr.id
    JOIN clients c ON sr.client_id = c.id
    JOIN service_types st ON sr.service_type_id = st.id
    LEFT JOIN client_sites cs ON sr.site_id = cs.id
    WHERE er.dispatched_employee_id = $1 AND er.status IN ('approved', 'dispatched')
    ORDER BY er.created_at ASC
  `, [empId]);

  // Get active time logs for each emergency
  for (const em of emergencies) {
    em.activeLog = await db.get(
      'SELECT * FROM emergency_time_logs WHERE emergency_request_id = $1 AND employee_id = $2 AND clocked_out_at IS NULL',
      [em.id, empId]
    );
    em.logs = await db.query(
      'SELECT * FROM emergency_time_logs WHERE emergency_request_id = $1 AND employee_id = $2 ORDER BY clocked_in_at DESC',
      [em.id, empId]
    );
  }

  res.render('employee/emergency', {
    title: 'Emergency Requests',
    employee: req.session.employee,
    emergencies
  });
});

router.post('/emergency/:eid/clockin', async (req, res) => {
  const empId = req.session.employee.id;
  // Check not already clocked in
  const existing = await db.get(
    'SELECT * FROM emergency_time_logs WHERE emergency_request_id = $1 AND employee_id = $2 AND clocked_out_at IS NULL',
    [req.params.eid, empId]
  );
  if (!existing) {
    await db.run(
      'INSERT INTO emergency_time_logs (emergency_request_id, employee_id) VALUES ($1, $2)',
      [req.params.eid, empId]
    );
    // Update emergency status to dispatched
    await db.run("UPDATE emergency_requests SET status = 'dispatched' WHERE id = $1", [req.params.eid]);
  }
  res.redirect('/employee/emergency');
});

router.post('/emergency/:eid/clockout', async (req, res) => {
  const empId = req.session.employee.id;
  const log = await db.get(
    'SELECT * FROM emergency_time_logs WHERE emergency_request_id = $1 AND employee_id = $2 AND clocked_out_at IS NULL',
    [req.params.eid, empId]
  );
  if (log) {
    const clockedIn = new Date(log.clocked_in_at);
    const now = new Date();
    const totalMinutes = Math.round((now - clockedIn) / 60000);
    await db.run(
      'UPDATE emergency_time_logs SET clocked_out_at = CURRENT_TIMESTAMP, total_minutes = $1 WHERE id = $2',
      [totalMinutes, log.id]
    );
  }
  res.redirect('/employee/emergency');
});

module.exports = router;
