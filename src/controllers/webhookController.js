const Lead = require('../models/Lead');
const LeadProcessor = require('../services/LeadProcessor');
const Joi = require('joi');

// Validation schema for FluentForms data
const fluentFormsSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().required(),
  cityzip: Joi.string().required(),
  date_time: Joi.string().allow(''),
  length: Joi.string().allow(''),
  type: Joi.string().required(),
  location: Joi.string().allow(''),
  contactpref: Joi.string().allow(''),
  email: Joi.string().email().allow('').optional(), // Optional email field
  provider_id: Joi.alternatives().try(
    Joi.number().integer(),
    Joi.string().pattern(/^provider(\d+)$/)
  ).optional() // For testing specific providers - accepts number or "provider10" format
});

class WebhookController {
  static async handleFluentFormsWebhook(req, res) {
    try {
      console.log('Received FluentForms webhook:', JSON.stringify(req.body, null, 2));

      // Validate webhook secret if configured (skip in development)
      if (process.env.WEBHOOK_SECRET && process.env.NODE_ENV !== 'development') {
        const receivedSecret = req.headers['x-webhook-secret'] || req.body.webhook_secret;
        if (receivedSecret !== process.env.WEBHOOK_SECRET) {
          console.error('Invalid webhook secret');
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }

      // Extract form data - FluentForms typically sends data in different formats
      let formData = req.body;
      
      // Handle different FluentForms webhook formats
      if (req.body.data && req.body.data.fields) {
        // Format: { data: { fields: { fieldName: { value: "..." } } } }
        const fields = req.body.data.fields;
        formData = {};
        Object.keys(fields).forEach(key => {
          formData[key] = fields[key].value || fields[key];
        });
      } else if (req.body.form_data) {
        // Format: { form_data: { fieldName: "value" } }
        formData = req.body.form_data;
      }

      // Debug: Log the raw form data to understand the structure
      console.log('Raw form data structure:', JSON.stringify(formData, null, 2));
      console.log('Original req.body:', JSON.stringify(req.body, null, 2));
      
      // Fix field values that might be labels instead of actual values
      if (formData.length === 'Session Length Preference') {
        console.log('Detected field label instead of value for length field');
        
        // Try to find the actual value in the original request body
        if (req.body.data && req.body.data.fields && req.body.data.fields.length) {
          const lengthField = req.body.data.fields.length;
          console.log('Length field details:', JSON.stringify(lengthField, null, 2));
          
          // Look for actual selected value in different possible locations
          if (lengthField.selected_value) {
            formData.length = lengthField.selected_value;
          } else if (lengthField.raw_value) {
            formData.length = lengthField.raw_value;
          } else if (lengthField.options && lengthField.options.length > 0) {
            // If we have options, try to find the selected one
            const selectedOption = lengthField.options.find(opt => opt.selected);
            if (selectedOption) {
              formData.length = selectedOption.value || selectedOption.label;
            }
          }
        }
        
        // If still no value found, set to not specified
        if (formData.length === 'Session Length Preference') {
          formData.length = 'Not specified';
        }
      }
      
      // Clean up date_time field - remove time if it's just default midnight
      if (formData.date_time && formData.date_time.includes('12:00:00 AM')) {
        formData.date_time = formData.date_time.replace(/\s+12:00:00 AM/, '').trim();
        console.log('Cleaned date_time field:', formData.date_time);
      }

      // Validate the form data
      const { error, value } = fluentFormsSchema.validate(formData);
      if (error) {
        console.error('Validation error:', error.details);
        return res.status(400).json({ 
          error: 'Invalid form data', 
          details: error.details 
        });
      }

      // Convert provider_id from "provider10" format to numeric if needed
      if (value.provider_id && typeof value.provider_id === 'string') {
        const match = value.provider_id.match(/^provider(\d+)$/);
        if (match) {
          value.provider_id = parseInt(match[1]);
          console.log('Converted provider_id from string to number:', value.provider_id);
        }
      }

      // Create the lead
      const lead = await Lead.create(value);
      console.log('Lead created:', lead.lead_id);
      console.log('Provider ID from form:', value.provider_id, 'Type:', typeof value.provider_id);

      // Process the lead asynchronously (with optional specific provider for testing)
      LeadProcessor.processNewLead(lead.lead_id, value.provider_id).catch(error => {
        console.error('Error processing lead:', error);
      });

      res.json({ 
        success: true, 
        leadId: lead.lead_id,
        providerId: value.provider_id || 'auto-matched',
        message: 'Lead received and processing started'
      });

    } catch (error) {
      console.error('Error handling FluentForms webhook:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  }

  static async handleStripeWebhook(req, res) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        await WebhookController.handleCheckoutCompleted(event.data.object);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Error handling Stripe webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  static async handleCheckoutCompleted(session) {
    const Unlock = require('../models/Unlock');
    const SMSService = require('../services/SMSService');
    const Lead = require('../models/Lead');
    const Provider = require('../models/Provider');

    try {
      const leadId = session.metadata.lead_id;
      const providerId = session.metadata.provider_id;
      const now = new Date().toISOString();

      console.log(`🎉 PAYMENT COMPLETED! Processing checkout completion for lead ${leadId}, provider ${providerId}`);
      console.log('Session ID:', session.id);
      
      // Check if this exact session has already been processed
      const pool = require('../config/database');
      const existingProcessed = await pool.query(
        'SELECT * FROM unlocks WHERE checkout_session_id = $1',
        [session.id]
      );
      
      console.log(`Checking for existing session ${session.id}:`, existingProcessed.rows);
      
      if (existingProcessed.rows.length > 0) {
        const existing = existingProcessed.rows[0];
        if (existing.status === 'PAID' || existing.status === 'REVEALED') {
          console.log(`Session ${session.id} already processed with status ${existing.status}, ignoring duplicate webhook`);
          await pool.query(`
            INSERT INTO unlock_audit_log (
              lead_id, provider_id, event_type, checkout_session_id, notes, created_at
            ) VALUES ($1, $2, 'DUPLICATE_SESSION_WEBHOOK', $3, $4, CURRENT_TIMESTAMP)
          `, [leadId, providerId, session.id, `Session already processed with status ${existing.status}`]);
          return;
        } else {
          console.log(`Session ${session.id} exists but status is ${existing.status}, continuing processing`);
        }
      }

      // Check if unlock exists first
      const unlockRecord = await Unlock.findByLeadAndProvider(leadId, providerId);
      console.log('Found unlock record:', unlockRecord);
      
      if (!unlockRecord) {
        console.error(`❌ Unlock not found for lead ${leadId}, provider ${providerId}`);
        console.log('Searching for any unlocks with similar lead ID...');
        
        // Try to find any unlock with similar lead ID
        const pool = require('../config/database');
        const searchQuery = `SELECT * FROM unlocks WHERE lead_id::text LIKE $1 LIMIT 5`;
        const searchResult = await pool.query(searchQuery, [`${leadId.substring(0, 8)}%`]);
        console.log('Similar unlocks found:', searchResult.rows);
        return;
      }

      // Handle duplicate payment detection
      const duplicateCheck = await Unlock.handleDuplicatePayment(leadId, providerId, session.id);
      if (duplicateCheck.action === 'duplicate_payment') {
        console.log('Duplicate payment detected, skipping - already processed');
        const provider = await Provider.findById(providerId);
        if (provider) {
          await SMSService.sendSMS(provider.phone, 
            `Duplicate payment detected. Lead ${leadId.substring(0, 8)} was already unlocked. No additional charges applied.`
          );
          
          // DO NOT resend customer details - they already have them
          console.log('Duplicate payment notification sent, customer details NOT resent');
        }
        return;
      }

      // Find the unlock record
      const unlock = await Unlock.findByLeadAndProvider(leadId, providerId);
      if (!unlock) {
        console.error('Unlock not found for payment completion');
        return;
      }

      // Check if already processed (idempotency)
      if (unlock.status === 'PAID' || unlock.status === 'REVEALED') {
        console.log(`Payment already processed (status: ${unlock.status}), skipping duplicate webhook`);
        
        // Log duplicate webhook attempt for debugging
        const pool = require('../config/database');
        await pool.query(`
          INSERT INTO unlock_audit_log (
            lead_id, provider_id, event_type, checkout_session_id, notes, created_at
          ) VALUES ($1, $2, 'DUPLICATE_WEBHOOK', $3, $4, CURRENT_TIMESTAMP)
        `, [leadId, providerId, session.id, `Status already ${unlock.status}, webhook ignored`]);
        
        return;
      }

      // Handle payment after TTL
      if (unlock.ttl_expires_at && new Date(unlock.ttl_expires_at) < new Date()) {
        console.log('Payment received after TTL, but still revealing since provider paid');
        const result = await Unlock.handlePaymentAfterTTL(session.id);
        if (result.action === 'reveal_after_ttl') {
          console.log('Lead marked as closed to prevent new unlocks');
        }
      }

      // Update status to PAID with audit trail
      await Unlock.updateStatus(leadId, providerId, 'PAID', {
        paid_at: now,
        unlocked_at: now,
        checkout_session_id: session.id
      });

      // Get the private lead details
      const leadDetails = await Lead.getPrivateFields(leadId);
      const publicDetails = await Lead.getPublicFields(leadId);

      // Get provider info
      const provider = await Provider.findById(providerId);

      if (leadDetails && provider) {
        // Send reveal SMS
        await SMSService.sendRevealDetails(provider.phone, leadDetails, publicDetails, leadId);

        // Update status to REVEALED with audit trail
        await Unlock.updateStatus(leadId, providerId, 'REVEALED', {
          revealed_at: now
        });

        console.log(`Successfully revealed lead details to provider ${providerId}`);
      }

    } catch (error) {
      console.error('Error processing checkout completion:', error);
      throw error;
    }
  }

  static async getProviderById(providerId) {
    const Provider = require('../models/Provider');
    return await Provider.findById(providerId);
  }
}

module.exports = WebhookController;
