const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../utils/db');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/portal');
  }
  res.render('auth/login', { title: 'Login', error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('auth/login', { title: 'Login', error: 'Invalid email or password' });
    }

    // If client, get client record
    let clientId = null;
    let companyName = null;
    let accessLevel = user.access_level || 'client';
    let siteId = user.site_id || null;
    if (user.role === 'client') {
      const client = await db.get('SELECT * FROM clients WHERE user_id = $1', [user.id]);
      if (!client) {
        // Check if this user is linked to a client via another mechanism (multi-user clients)
        // For now, check if there's a client where user_id matches OR client_id is stored differently
        // site-level users: find the client via site_id
        if (siteId) {
          const site = await db.get('SELECT * FROM client_sites WHERE id = $1', [siteId]);
          if (site) {
            clientId = site.client_id;
            const clientRec = await db.get('SELECT * FROM clients WHERE id = $1', [site.client_id]);
            if (clientRec) companyName = clientRec.company_name;
          }
        }
      } else {
        clientId = client.id;
        companyName = client.company_name;
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
      accessLevel,
      siteId
    };

    res.redirect(user.role === 'admin' ? '/admin' : '/portal');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', { title: 'Login', error: 'Something went wrong' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

module.exports = router;
