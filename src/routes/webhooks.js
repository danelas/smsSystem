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

// TextMagic incoming SMS webhook
router.post('/sms/incoming', express.json(), async (req, res) => {
  try {
    console.log('Incoming SMS webhook:', req.body);

    const { from, text, message_id } = req.body;
    
    if (!from || !text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Process the incoming message
    const result = await LeadProcessor.handleProviderResponse(from, text);
    
    res.json({ 
      success: true, 
      action: result.action,
      message_id: message_id 
    });

  } catch (error) {
    console.error('Error handling incoming SMS:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual lead processing endpoint (for testing)
router.post('/process-lead/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    
    // Process the lead
    await LeadProcessor.processNewLead(leadId);
    
    res.json({ success: true, message: 'Lead processing started' });

  } catch (error) {
    console.error('Error processing lead manually:', error);
    res.status(500).json({ error: error.message });
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
    const result = await pool.query('SELECT * FROM providers ORDER BY provider_id');
    
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

// Database setup endpoint
router.post('/setup/database', async (req, res) => {
  try {
    console.log('🔄 Starting database setup...');
    const setupDatabase = require('../../scripts/setup-database-render');
    await setupDatabase();
    
    res.json({
      success: true,
      message: 'Database setup completed successfully'
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
