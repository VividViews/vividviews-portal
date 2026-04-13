require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { migrate } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view options', { rmWhitespace: false });
const ejs = require('ejs');
ejs.cache.reset(); // clear any stale cache on startup

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start
async function start() {
  await migrate();

  // Session (must be set up after migrate so session table exists)
  const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  };

  if (process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    const pgSession = require('connect-pg-simple')(session);
    const { Pool } = require('pg');
    sessionConfig.store = new pgSession({
      pool: new Pool({ connectionString: process.env.DATABASE_URL }),
      tableName: 'session'
    });
  }

  app.use(session(sessionConfig));

  // Make user available to all views
  app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.currentEmployee = req.session.employee || null;
    next();
  });

  // Method override for DELETE via POST
  app.use((req, res, next) => {
    if (req.body && req.body._method) {
      req.method = req.body._method.toUpperCase();
      delete req.body._method;
    }
    next();
  });

  // Routes
  app.use('/auth', require('./routes/auth'));
  app.use('/admin', require('./routes/admin'));
  app.use('/portal', require('./routes/portal'));
  app.use('/employee', require('./routes/employees'));

  // Root redirect
  app.get('/', (req, res) => {
    if (req.session.employee) {
      return res.redirect('/employee');
    }
    if (req.session.user) {
      return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/portal');
    }
    res.redirect('/auth/login');
  });

  app.listen(PORT, () => {
    console.log(`🚀 Vivid Views Portal running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
