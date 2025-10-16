const express = require('express');
const router = express.Router();
const WebhookController = require('../controllers/webhookController');
const LeadProcessor = require('../services/LeadProcessor');

// FluentForms webhook endpoint
router.post('/fluentforms', express.json(), WebhookController.handleFluentFormsWebhook);

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

module.exports = router;
