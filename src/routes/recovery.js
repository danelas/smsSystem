const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const LeadProcessor = require('../services/LeadProcessor');

// Test endpoint to verify recovery routes are working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Recovery routes are working!',
    timestamp: new Date()
  });
});

// Find and process missed leads (GET version for easy testing)
router.get('/process-missed-leads', async (req, res) => {
  try {
    const { hours = 48 } = req.query; // Default to last 48 hours
    
    // Find leads that were created but never sent to providers
    const missedLeadsQuery = `
      SELECT l.* 
      FROM leads l
      LEFT JOIN unlocks u ON l.lead_id = u.lead_id
      WHERE l.created_at >= NOW() - INTERVAL '${hours} hours'
      AND u.lead_id IS NULL
      ORDER BY l.created_at DESC
    `;
    
    const result = await pool.query(missedLeadsQuery);
    const missedLeads = result.rows;
    
    console.log(`Found ${missedLeads.length} missed leads from the last ${hours} hours`);
    
    const processedLeads = [];
    const errors = [];
    
    // Process each missed lead
    for (const lead of missedLeads) {
      try {
        console.log(`Processing missed lead: ${lead.lead_id} - ${lead.client_name}`);
        
        // Process the lead normally (this will respect business hours)
        await LeadProcessor.processNewLead(lead.lead_id);
        
        processedLeads.push({
          lead_id: lead.lead_id,
          client_name: lead.client_name,
          service_type: lead.service_type,
          created_at: lead.created_at,
          status: 'processed'
        });
        
      } catch (error) {
        console.error(`Error processing missed lead ${lead.lead_id}:`, error);
        errors.push({
          lead_id: lead.lead_id,
          client_name: lead.client_name,
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      summary: {
        total_missed_leads: missedLeads.length,
        successfully_processed: processedLeads.length,
        errors: errors.length
      },
      processed_leads: processedLeads,
      errors: errors
    });
    
  } catch (error) {
    console.error('Error in process-missed-leads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process missed leads',
      details: error.message
    });
  }
});

// Get missed leads without processing them
router.get('/missed-leads', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    
    // Find leads that were created but never sent to providers
    const missedLeadsQuery = `
      SELECT 
        l.*,
        COUNT(u.unlock_id) as unlock_count
      FROM leads l
      LEFT JOIN unlocks u ON l.lead_id = u.lead_id
      WHERE l.created_at >= NOW() - INTERVAL '${hours} hours'
      GROUP BY l.lead_id, l.client_name, l.service_type, l.city, l.created_at, l.phone, l.email, l.provider_id
      HAVING COUNT(u.unlock_id) = 0
      ORDER BY l.created_at DESC
    `;
    
    const result = await pool.query(missedLeadsQuery);
    
    res.json({
      success: true,
      missed_leads: result.rows,
      count: result.rows.length,
      period: `Last ${hours} hours`
    });
    
  } catch (error) {
    console.error('Error getting missed leads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get missed leads'
    });
  }
});

// Get recent leads with their processing status
router.get('/recent-leads-status', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    
    const query = `
      SELECT 
        l.lead_id,
        l.client_name,
        l.service_type,
        l.city,
        l.created_at,
        COUNT(u.unlock_id) as providers_notified,
        COUNT(CASE WHEN u.status = 'REVEALED' THEN 1 END) as providers_paid,
        MAX(u.created_at) as last_notification_sent
      FROM leads l
      LEFT JOIN unlocks u ON l.lead_id = u.lead_id
      WHERE l.created_at >= NOW() - INTERVAL '${hours} hours'
      GROUP BY l.lead_id, l.client_name, l.service_type, l.city, l.created_at
      ORDER BY l.created_at DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      recent_leads: result.rows,
      period: `Last ${hours} hours`
    });
    
  } catch (error) {
    console.error('Error getting recent leads status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recent leads status'
    });
  }
});

// Manual fix for missed payments (temporary location)
router.post('/fix-payment', async (req, res) => {
  try {
    const { leadId, providerId, checkoutSessionId } = req.body;
    
    if (!leadId || !providerId) {
      return res.status(400).json({
        success: false,
        error: 'leadId and providerId are required'
      });
    }
    
    console.log(`Manual fix for missed payment: ${leadId}, ${providerId}`);
    
    // Check if unlock exists
    const unlockQuery = `SELECT * FROM unlocks WHERE lead_id = $1 AND provider_id = $2`;
    const unlockResult = await pool.query(unlockQuery, [leadId, providerId]);
    
    if (unlockResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Unlock record not found'
      });
    }
    
    const unlock = unlockResult.rows[0];
    
    if (unlock.status !== 'PAYMENT_LINK_SENT') {
      return res.json({
        success: false,
        error: `Cannot fix - current status is ${unlock.status}, expected PAYMENT_LINK_SENT`
      });
    }
    
    const now = new Date().toISOString();
    
    // Update to PAID status
    const Unlock = require('../models/Unlock');
    await Unlock.updateStatus(leadId, providerId, 'PAID', {
      paid_at: now,
      unlocked_at: now,
      checkout_session_id: checkoutSessionId || unlock.checkout_session_id
    });
    
    // Get lead and provider details
    const Lead = require('../models/Lead');
    const Provider = require('../models/Provider');
    const SMSService = require('../services/SMSService');
    
    const leadDetails = await Lead.getPrivateFields(leadId);
    const publicDetails = await Lead.getPublicFields(leadId);
    const provider = await Provider.findById(providerId);
    
    if (leadDetails && provider) {
      // Send reveal SMS
      await SMSService.sendRevealDetails(provider.phone, leadDetails, publicDetails, leadId);
      
      // Update to REVEALED status
      await Unlock.updateStatus(leadId, providerId, 'REVEALED', {
        revealed_at: now
      });
      
      console.log(`Successfully revealed lead details to provider ${providerId}`);
    }
    
    res.json({
      success: true,
      message: 'Payment issue fixed and lead details sent',
      provider_phone: provider.phone,
      client_name: leadDetails.client_name
    });
    
  } catch (error) {
    console.error('Error fixing missed payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fix missed payment',
      details: error.message
    });
  }
});

module.exports = router;
