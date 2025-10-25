const express = require('express');
const router = express.Router();
const crypto = require('crypto'); // Ensure crypto is available
const WebhookController = require('../controllers/webhookController');
const LeadProcessor = require('../services/LeadProcessor');
const migration = require('../migrations/001_add_first_lead_flag');

// FluentForms webhook endpoint
router.post('/fluentforms', express.json(), WebhookController.handleFluentFormsWebhook);

// GET handler for debugging (when someone visits the URL in browser)
router.get('/fluentforms', (req, res) => {
  console.log('=== GET REQUEST TO FLUENTFORMS WEBHOOK ===');
  console.log('This should be a POST request from FluentForms');
  console.log('Query params:', req.query);
  console.log('=== END GET REQUEST ===');
  
  res.json({
    error: 'This endpoint expects POST requests from FluentForms',
    message: 'Configure FluentForms to send POST requests to this URL',
    correctUrl: `${process.env.DOMAIN}/webhooks/fluentforms`,
    method: 'POST'
  });
});

// Stripe webhook endpoint (needs raw body)
router.post('/stripe', express.raw({ type: 'application/json' }), WebhookController.handleStripeWebhook);

// GET handler for Stripe webhook (for testing connectivity)
router.get('/stripe', (req, res) => {
  console.log('=== GET REQUEST TO STRIPE WEBHOOK ===');
  console.log('Stripe should send POST requests to this URL');
  console.log('=== END GET REQUEST ===');
  
  res.json({
    message: 'Stripe webhook endpoint is reachable',
    method: 'POST required',
    url: `${process.env.DOMAIN}/webhooks/stripe`,
    instructions: 'Configure this URL in Stripe Dashboard → Webhooks',
    events_to_listen: ['checkout.session.completed'],
    status: 'ready'
  });
});

// TextMagic incoming SMS webhook (GET for testing)
router.get('/sms/incoming', (req, res) => {
  console.log('GET request to SMS webhook - this is for testing');
  console.log('Query params:', req.query);
  res.json({
    message: 'SMS webhook is working',
    method: 'GET',
    query: req.query,
    instructions: 'TextMagic should send POST requests here'
  });
});

// TextMagic incoming SMS webhook
router.post('/sms/incoming', express.json(), async (req, res) => {
  try {
    console.log('=== INCOMING SMS WEBHOOK DEBUG ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('Query:', JSON.stringify(req.query, null, 2));
    console.log('Raw body type:', typeof req.body);
    console.log('Raw body keys:', Object.keys(req.body || {}));
    console.log('=== END DEBUG ===');

    // Try different possible field names that TextMagic might use
    const body = req.body || {};
    const from = body.from || body.sender || body.phone || body.number;
    const text = body.text || body.message || body.body || body.content;
    const messageId = body.message_id || body.messageId || body.id;
    
    console.log('Extracted fields:');
    console.log('- from:', from);
    console.log('- text:', text);
    console.log('- messageId:', messageId);
    
    if (!from || !text) {
      console.log('Missing required fields - sending error response');
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: body,
        expected: ['from/sender/phone', 'text/message/body']
      });
    }

    console.log(`Processing SMS: ${from} -> "${text}"`);
    
    // Process the incoming message
    const result = await LeadProcessor.handleProviderResponse(from, text);
    
    console.log('Processing result:', result);
    
    res.json({ 
      success: true, 
      action: result.action,
      message_id: messageId 
    });

  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Manual lead processing endpoint (for testing)
router.post('/process-lead/:leadId', async (req, res) => {
  try {
    await LeadProcessor.processNewLead(req.params.leadId);
    res.json({ success: true, message: 'Lead processing started' });
  } catch (error) {
    console.error('Error processing lead:', error);
    res.status(500).json({ error: error.message });
  }
});

// List current unlocks for debugging
router.get('/test/list-unlocks', async (req, res) => {
  try {
    const pool = require('../config/database');
    const query = `
      SELECT lead_id, provider_id, status, created_at, payment_link_url 
      FROM unlocks 
      ORDER BY created_at DESC 
      LIMIT 10
    `;
    
    const result = await pool.query(query);
    
    res.json({ 
      success: true, 
      unlocks: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Error listing unlocks:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Manual unlock creation for testing
router.post('/test/create-unlock', express.json(), async (req, res) => {
  try {
    const { leadId, providerId } = req.body;
    
    if (!leadId || !providerId) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['leadId', 'providerId'],
        example: {
          leadId: '4cee9e25-082e-4d42-a7d3-c32a401cad01',
          providerId: 'provider10'
        }
      });
    }

    console.log(`Creating test unlock for lead ${leadId} and provider ${providerId}`);
    
    const Unlock = require('../models/Unlock');
    const unlock = await Unlock.create(leadId, providerId);
    
    console.log('Test unlock created:', unlock);
    
    res.json({ 
      success: true, 
      unlock: unlock,
      message: 'Test unlock created successfully. Now you can reply Y to SMS.'
    });

  } catch (error) {
    console.error('Error creating test unlock:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Manual payment completion test
router.post('/test/payment-complete', express.json(), async (req, res) => {
  try {
    const { leadId, providerId } = req.body;
    
    if (!leadId || !providerId) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['leadId', 'providerId'],
        example: {
          leadId: 'b811a43d-...',
          providerId: 'provider10'
        }
      });
    }

    console.log(`🧪 Manual payment completion test for lead ${leadId}, provider ${providerId}`);
    
    // Simulate the payment completion
    const mockSession = {
      id: 'cs_test_manual_' + Date.now(),
      metadata: {
        lead_id: leadId,
        provider_id: providerId
      }
    };
    
    await WebhookController.handleCheckoutCompleted(mockSession);
    
    res.json({ 
      success: true, 
      message: 'Payment completion simulated - check for SMS with contact details!'
    });

  } catch (error) {
    console.error('Error simulating payment completion:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Manual provider response endpoint (for testing when TextMagic webhook isn't set up)
router.post('/test/provider-response', express.json(), async (req, res) => {
  try {
    const { phone, message, leadId } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['phone', 'message'],
        example: {
          phone: '+17542806739',
          message: 'Y',
          leadId: 'optional-lead-id'
        }
      });
    }

    console.log(`Manual provider response test: ${phone} -> ${message}`);
    
    // Process the response
    const result = await LeadProcessor.handleProviderResponse(phone, message, leadId);
    
    res.json({ 
      success: true, 
      result: result,
      message: 'Provider response processed successfully'
    });

  } catch (error) {
    console.error('Error processing manual provider response:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Cleanup expired unlocks endpoint
router.post('/cleanup/expired', async (req, res) => {
  try {
    await LeadProcessor.processExpiredUnlocks();
    res.json({ success: true, message: 'Expired unlocks processed' });
  } catch (error) {
    console.error('Error cleaning up expired unlocks:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test webhook endpoint to debug form submissions
router.post('/test-webhook', (req, res) => {
  console.log('=== TEST WEBHOOK RECEIVED ===');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('Query:', JSON.stringify(req.query, null, 2));
  console.log('=== END TEST WEBHOOK ===');
  
  res.json({ 
    success: true, 
    message: 'Test webhook received',
    receivedData: req.body 
  });
});

// Debug endpoint to check providers in database
router.get('/debug/providers', async (req, res) => {
  try {
    const pool = require('../config/database');
    const result = await pool.query('SELECT * FROM providers ORDER BY id');
    
    console.log('=== PROVIDERS IN DATABASE ===');
    console.log(JSON.stringify(result.rows, null, 2));
    console.log('=== END PROVIDERS ===');
    
    res.json({
      success: true,
      providers: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Database inspection endpoint
router.get('/debug/schema', async (req, res) => {
  try {
    const pool = require('../config/database');
    
    // Get table schema
    const schemaQuery = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'providers' 
      ORDER BY ordinal_position;
    `;
    
    const schemaResult = await pool.query(schemaQuery);
    
    // Get sample data
    const dataQuery = 'SELECT * FROM providers LIMIT 3';
    const dataResult = await pool.query(dataQuery);
    
    res.json({
      success: true,
      table_schema: schemaResult.rows,
      sample_data: dataResult.rows
    });
  } catch (error) {
    console.error('Schema inspection failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Database setup endpoint
router.post('/setup/database', async (req, res) => {
  try {
    console.log('🔄 Starting database setup...');
    const pool = require('../config/database');
    
    // Skip schema creation - database already exists with different structure
    console.log('✅ Using existing database schema');
    
    // Add providers if they don't exist (using actual database columns)
    const providerInsert = `
      INSERT INTO providers (id, name, phone)
      VALUES 
        ('provider1', 'Lisa', '+17542806739'),
        ('provider2', 'Nara', '+13053169435'),
        ('provider3', 'Maylin', '+13053180715')
      ON CONFLICT (id) DO NOTHING
      RETURNING id, name;
    `;
    
    const providerResult = await pool.query(providerInsert);
    console.log('✅ Providers added:', providerResult.rows);
    
    // Get all providers
    const allProviders = await pool.query('SELECT id, name, phone FROM providers ORDER BY id');
    
    res.json({
      success: true,
      message: 'Database setup completed successfully',
      providers: allProviders.rows
    });
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    res.status(500).json({
      success: false,
      error: 'Database setup failed',
      details: error.message
    });
  }
});

// Stripe environment diagnostic endpoint
router.get('/stripe/diagnostics', (req, res) => {
  try {
    console.log('=== STRIPE ENVIRONMENT DIAGNOSTICS ===');
    
    const diagnostics = {
      timestamp: new Date().toISOString(),
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      crypto_available: typeof crypto,
      crypto_methods: {},
      stripe_config: {},
      environment_vars: {},
      modules: {}
    };

    // Check crypto methods
    if (typeof crypto === 'object') {
      diagnostics.crypto_methods = {
        createHmac: typeof crypto.createHmac,
        createHash: typeof crypto.createHash,
        randomBytes: typeof crypto.randomBytes,
        constants: typeof crypto.constants
      };
    }

    // Check Stripe configuration (without exposing secrets)
    try {
      const stripe = require('stripe');
      diagnostics.stripe_config = {
        stripe_module_loaded: typeof stripe,
        secret_key_configured: !!process.env.STRIPE_SECRET_KEY,
        webhook_secret_configured: !!process.env.STRIPE_WEBHOOK_SECRET,
        secret_key_length: process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.length : 0,
        webhook_secret_length: process.env.STRIPE_WEBHOOK_SECRET ? process.env.STRIPE_WEBHOOK_SECRET.length : 0
      };
    } catch (stripeError) {
      diagnostics.stripe_config.error = stripeError.message;
    }

    // Check environment variables (without exposing values)
    diagnostics.environment_vars = {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      has_database_url: !!process.env.DATABASE_URL,
      has_textmagic_config: !!(process.env.TEXTMAGIC_USERNAME && process.env.TEXTMAGIC_API_KEY)
    };

    // Check loaded modules
    try {
      diagnostics.modules = {
        crypto_builtin: !!require.resolve('crypto'),
        stripe_installed: !!require.resolve('stripe'),
        express_installed: !!require.resolve('express')
      };
    } catch (moduleError) {
      diagnostics.modules.error = moduleError.message;
    }

    console.log('Diagnostics result:', JSON.stringify(diagnostics, null, 2));
    console.log('=== END STRIPE DIAGNOSTICS ===');

    res.json({
      success: true,
      diagnostics: diagnostics,
      recommendations: [
        'Check if crypto_available shows "object"',
        'Verify stripe_module_loaded shows "function"', 
        'Ensure secret keys are configured',
        'Node version should be >= 18 for full crypto support'
      ]
    });

  } catch (error) {
    console.error('Diagnostics failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Test Stripe webhook signature verification
router.post('/stripe/test-signature', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    console.log('=== STRIPE SIGNATURE TEST ===');
    
    const testResult = {
      timestamp: new Date().toISOString(),
      crypto_available: typeof crypto,
      body_type: typeof req.body,
      body_length: req.body ? req.body.length : 0,
      headers: req.headers,
      signature_header: req.headers['stripe-signature']
    };

    // Try to use crypto directly
    if (typeof crypto === 'object') {
      try {
        const testHash = crypto.createHmac('sha256', 'test-secret').update('test-data').digest('hex');
        testResult.crypto_test = {
          success: true,
          test_hash: testHash
        };
      } catch (cryptoError) {
        testResult.crypto_test = {
          success: false,
          error: cryptoError.message
        };
      }
    }

    // Try Stripe webhook construction with dummy data
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
      
      // This will likely fail but we want to see the exact error
      const dummyPayload = JSON.stringify({ test: true });
      const dummySignature = 'dummy_signature';
      
      stripe.webhooks.constructEvent(dummyPayload, dummySignature, endpointSecret);
      
    } catch (stripeError) {
      testResult.stripe_test = {
        error: stripeError.message,
        stack: stripeError.stack
      };
    }

    console.log('Signature test result:', JSON.stringify(testResult, null, 2));
    console.log('=== END SIGNATURE TEST ===');

    res.json({
      success: true,
      test_result: testResult
    });

  } catch (error) {
    console.error('Signature test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// GET version for easy browser access
router.get('/setup/database', async (req, res) => {
  try {
    console.log('🔄 Starting database setup via GET...');
    const pool = require('../config/database');
    
    // Skip schema creation - database already exists with different structure
    console.log('✅ Using existing database schema');
    
    // Add providers if they don't exist (using actual database columns)
    const providerInsert = `
      INSERT INTO providers (id, name, phone)
      VALUES 
        ('provider1', 'Lisa', '+17542806739'),
        ('provider2', 'Nara', '+13053169435'),
        ('provider3', 'Maylin', '+13053180715')
      ON CONFLICT (id) DO NOTHING
      RETURNING id, name;
    `;
    
    const providerResult = await pool.query(providerInsert);
    console.log('✅ Providers added:', providerResult.rows);
    
    // Get all providers
    const allProviders = await pool.query('SELECT id, name, phone FROM providers ORDER BY id');
    
    res.json({
      success: true,
      message: 'Database setup completed successfully! You can now test your forms.',
      providers: allProviders.rows,
      instructions: {
        testWith: 'Use provider_id values: provider1, provider2, or provider3',
        webhook: `${process.env.DOMAIN}/webhooks/fluentforms`
      }
    });
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    res.status(500).json({
      success: false,
      error: 'Database setup failed',
      details: error.message
    });
  }
});

// One-time migration endpoint to add first_lead_used column
router.get('/run-migration-first-lead', async (req, res) => {
  try {
    console.log('🔄 Running first lead migration...');
    await migration.up();
    
    res.json({
      success: true,
      message: '✅ Migration completed successfully!',
      migration: 'add_first_lead_used_column',
      note: 'All providers are now eligible for their first free lead'
    });
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error.message
    });
  }
});

// Reset first_lead_used for a specific provider (for testing)
router.get('/reset-first-lead/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const pool = require('../config/database');
    
    await pool.query(
      'UPDATE providers SET first_lead_used = FALSE WHERE id = $1',
      [providerId]
    );
    
    const result = await pool.query(
      'SELECT id, name, first_lead_used FROM providers WHERE id = $1',
      [providerId]
    );
    
    res.json({
      success: true,
      message: `✅ Reset first_lead_used for ${providerId}`,
      provider: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Reset failed:', error);
    res.status(500).json({
      success: false,
      error: 'Reset failed',
      details: error.message
    });
  }
});

// Check all providers' first_lead_used status
router.get('/check-first-lead-status', async (req, res) => {
  try {
    const pool = require('../config/database');
    
    const result = await pool.query(`
      SELECT id, name, phone, email, first_lead_used, created_at, updated_at
      FROM providers 
      ORDER BY id
    `);
    
    const stats = {
      total: result.rows.length,
      eligible_for_free: result.rows.filter(p => !p.first_lead_used).length,
      already_used: result.rows.filter(p => p.first_lead_used).length
    };
    
    res.json({
      success: true,
      stats,
      providers: result.rows
    });
  } catch (error) {
    console.error('❌ Check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Check failed',
      details: error.message
    });
  }
});

// Set specific providers to have used their first lead (POST)
router.post('/set-first-lead-used', express.json(), async (req, res) => {
  try {
    const { providerIds } = req.body; // Array of provider IDs
    const pool = require('../config/database');
    
    if (!Array.isArray(providerIds)) {
      return res.status(400).json({
        success: false,
        error: 'providerIds must be an array'
      });
    }
    
    // Set to TRUE for specified providers
    await pool.query(
      'UPDATE providers SET first_lead_used = TRUE WHERE id = ANY($1)',
      [providerIds]
    );
    
    // Get updated providers
    const result = await pool.query(
      'SELECT id, name, first_lead_used FROM providers WHERE id = ANY($1) ORDER BY id',
      [providerIds]
    );
    
    res.json({
      success: true,
      message: `✅ Set first_lead_used = TRUE for ${providerIds.length} providers`,
      updated: result.rows
    });
  } catch (error) {
    console.error('❌ Update failed:', error);
    res.status(500).json({
      success: false,
      error: 'Update failed',
      details: error.message
    });
  }
});

// Set specific providers to TRUE via GET (for easy browser testing)
router.get('/set-used-true', async (req, res) => {
  try {
    const pool = require('../config/database');
    const providerIds = ['provider14', 'provider91', 'provider50', 'provider32', 'provider47', 'provider46'];
    
    // Set to TRUE for specified providers
    await pool.query(
      'UPDATE providers SET first_lead_used = TRUE WHERE id = ANY($1)',
      [providerIds]
    );
    
    // Get updated providers
    const result = await pool.query(
      'SELECT id, name, first_lead_used FROM providers WHERE id = ANY($1) ORDER BY id',
      [providerIds]
    );
    
    res.json({
      success: true,
      message: `✅ Set first_lead_used = TRUE for these providers`,
      providers: providerIds,
      updated: result.rows
    });
  } catch (error) {
    console.error('❌ Update failed:', error);
    res.status(500).json({
      success: false,
      error: 'Update failed',
      details: error.message
    });
  }
});

// Set ALL other providers to FALSE (everyone else gets free lead)
router.get('/set-all-others-false', async (req, res) => {
  try {
    const pool = require('../config/database');
    const excludeIds = ['provider14', 'provider91', 'provider50', 'provider32', 'provider47', 'provider46'];
    
    // Set to FALSE for all providers NOT in the exclude list
    await pool.query(
      'UPDATE providers SET first_lead_used = FALSE WHERE id != ALL($1)',
      [excludeIds]
    );
    
    // Get stats
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE first_lead_used = TRUE) as used_true,
        COUNT(*) FILTER (WHERE first_lead_used = FALSE) as used_false
      FROM providers
    `);
    
    res.json({
      success: true,
      message: `✅ Set all providers (except specified 6) to first_lead_used = FALSE`,
      excluded: excludeIds,
      stats: stats.rows[0]
    });
  } catch (error) {
    console.error('❌ Update failed:', error);
    res.status(500).json({
      success: false,
      error: 'Update failed',
      details: error.message
    });
  }
});

module.exports = router;
