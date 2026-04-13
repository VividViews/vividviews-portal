const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../utils/db');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/portal');
  }
  res.render('auth/login', { title: 'Login', error: null, success: req.query.reset === 'ok' ? 'Password reset successfully. Please sign in.' : null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid email or password', success: null });
    }

    // If client, get client record
    let clientId = null;
    let companyName = null;
    let companyLogo = '';
    let brandColor = '#00d4ff';
    let accessLevel = user.access_level || 'client';
    let siteId = user.site_id || null;
    if (user.role === 'client') {
      const client = await db.get('SELECT * FROM clients WHERE user_id = $1', [user.id]);
      if (!client) {
        if (siteId) {
          const site = await db.get('SELECT * FROM client_sites WHERE id = $1', [siteId]);
          if (site) {
            clientId = site.client_id;
            const clientRec = await db.get('SELECT * FROM clients WHERE id = $1', [site.client_id]);
            if (clientRec) {
              companyName = clientRec.company_name;
              companyLogo = clientRec.logo_url || '';
              brandColor = clientRec.brand_color || '#00d4ff';
            }
          }
        }
      } else {
        clientId = client.id;
        companyName = client.company_name;
        companyLogo = client.logo_url || '';
        brandColor = client.brand_color || '#00d4ff';
      }
    }

    if (user.role === 'admin') {
      accessLevel = 'admin';
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clientId,
      companyName,
      companyLogo,
      brandColor,
      accessLevel,
      siteId
    };

    res.redirect(user.role === 'admin' ? '/admin' : '/portal');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { title: 'Login', error: 'Something went wrong', success: null });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

// Forgot password
router.get('/forgot', (req, res) => {
  res.render('auth/forgot', { title: 'Forgot Password', message: null });
});

router.post('/forgot', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await db.get('SELECT id FROM users WHERE email = $1', [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = db.type === 'pg'
        ? new Date(Date.now() + 3600000).toISOString()
        : new Date(Date.now() + 3600000).toISOString();
      await db.run(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, token, expiresAt]
      );
      const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset/${token}`;
      console.log(`\n🔑 PASSWORD RESET LINK: ${resetUrl}\n`);
    }
  } catch (err) {
    console.error('Forgot password error:', err);
  }
  res.render('auth/forgot', { title: 'Forgot Password', message: 'If that email exists, a reset link has been sent.' });
});

// Reset password
router.get('/reset/:token', async (req, res) => {
  try {
    const reset = await db.get(
      db.type === 'pg'
        ? "SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()"
        : "SELECT * FROM password_resets WHERE token = $1 AND used = 0 AND expires_at > datetime('now')",
      [req.params.token]
    );
    if (!reset) {
      return res.render('auth/forgot', { title: 'Forgot Password', message: 'Invalid or expired reset link. Please request a new one.' });
    }
    res.render('auth/reset', { title: 'Reset Password', token: req.params.token, error: null });
  } catch (err) {
    console.error('Reset page error:', err);
    res.redirect('/auth/forgot');
  }
});

router.post('/reset/:token', async (req, res) => {
  const { password, password_confirm } = req.body;
  try {
    if (!password || password.length < 6) {
      return res.render('auth/reset', { title: 'Reset Password', token: req.params.token, error: 'Password must be at least 6 characters.' });
    }
    if (password !== password_confirm) {
      return res.render('auth/reset', { title: 'Reset Password', token: req.params.token, error: 'Passwords do not match.' });
    }
    const reset = await db.get(
      db.type === 'pg'
        ? "SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()"
        : "SELECT * FROM password_resets WHERE token = $1 AND used = 0 AND expires_at > datetime('now')",
      [req.params.token]
    );
    if (!reset) {
      return res.render('auth/forgot', { title: 'Forgot Password', message: 'Invalid or expired reset link.' });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, reset.user_id]);
    const usedVal = db.type === 'pg' ? true : 1;
    await db.run('UPDATE password_resets SET used = $1 WHERE id = $2', [usedVal, reset.id]);
    res.redirect('/auth/login?reset=ok');
  } catch (err) {
    console.error('Reset password error:', err);
    res.render('auth/reset', { title: 'Reset Password', token: req.params.token, error: 'Something went wrong.' });
  }
});

module.exports = router;
