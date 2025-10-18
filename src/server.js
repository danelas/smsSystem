require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Import routes
const webhookRoutes = require('./routes/webhooks');
const apiRoutes = require('./routes/api');
const unlockRoutes = require('./routes/unlocks');
const providerRoutes = require('./routes/providers');
const analyticsRoutes = require('./routes/analytics');

// Import services for initialization
const pool = require('./config/database');
const LeadScheduler = require('./services/LeadScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required for Render and other hosting platforms
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"], // Allow inline scripts for our HTML pages
    },
  },
}));
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Webhook rate limiting (more restrictive)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per minute
  message: 'Too many webhook requests, please try again later.'
});
app.use('/webhooks/', webhookLimiter);

// Serve static files
app.use(express.static('public'));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsing middleware
// Note: Stripe webhook needs raw body, so we exclude it from JSON parsing
app.use((req, res, next) => {
  if (req.path === '/webhooks/stripe') {
    next(); // Skip JSON parsing for Stripe webhook
  } else {
    express.json({ limit: '10mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/webhooks', webhookRoutes);
app.use('/api', apiRoutes);
app.use('/unlocks', unlockRoutes);
app.use('/providers', providerRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/form', providerRoutes); // Also handle /form/:slug routes

// Provider URLs page
app.get('/provider-urls', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'provider-urls.html'));
});

// Form page for providers
app.get('/form/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Gold Touch Lead Management System',
    status: 'running',
    endpoints: {
      webhooks: '/webhooks/fluentforms',
      providers: '/providers',
      unlocks: '/unlocks',
      provider_urls: '/provider-urls',
      analytics: {
        provider_performance: '/analytics/providers',
        recent_activity: '/analytics/recent-activity?days=7',
        conversion_funnel: '/analytics/conversion-funnel',
        scheduled_leads: '/analytics/scheduled-leads'
      }
    },
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  
  try {
    await pool.end();
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database connections:', error);
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  
  try {
    await pool.end();
    console.log('Database connections closed');
  } catch (error) {
    console.error('Error closing database connections:', error);
  }
  
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`Gold Touch Lead Unlock System running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Start the lead scheduler
  LeadScheduler.startScheduler();
  
  // Test database connection
  pool.query('SELECT NOW()', (err, result) => {
    if (err) {
      console.error('Database connection failed:', err);
    } else {
      console.log('Database connected successfully');
    }
  });
});

module.exports = app;
