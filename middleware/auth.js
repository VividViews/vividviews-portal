function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/auth/login');
  }
  next();
}

function requireClient(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'client') {
    return res.redirect('/auth/login');
  }
  next();
}

function requireEmployee(req, res, next) {
  if (!req.session.employee) {
    return res.redirect('/employee/login');
  }
  next();
}

module.exports = { requireLogin, requireAdmin, requireClient, requireEmployee };
