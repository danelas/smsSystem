const express = require('express');
const router = express.Router();
const WebhookController = require('../controllers/webhookController');
const LeadProcessor = require('../services/LeadProcessor');

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
    correctUrl: 'https://smssystem.onrender.com/webhooks/fluentforms',
    method: 'POST'
  });
});

// Stripe webhook endpoint (needs raw body)
router.post('/stripe', express.raw({ type: 'application/json' }), WebhookController.handleStripeWebhook);

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
    const WebhookController = require('../controllers/webhookController');
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
      ON CONFLICT (phone) DO NOTHING
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
      ON CONFLICT (phone) DO NOTHING
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
        webhook: 'https://smssystem.onrender.com/webhooks/fluentforms'
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

module.exports = router;
