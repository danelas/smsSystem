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

module.exports = router;
