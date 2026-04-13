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
    if (user.role === 'client') {
      const client = await db.get('SELECT * FROM clients WHERE user_id = $1', [user.id]);
      if (client) {
        clientId = client.id;
        companyName = client.company_name;
      }
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clientId,
      companyName
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
