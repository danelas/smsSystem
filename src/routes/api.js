const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const LeadProviderInteraction = require('../models/LeadProviderInteraction');
const LeadProcessor = require('../services/LeadProcessor');

// Get lead details (public fields only)
router.get('/leads/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const lead = await Lead.getPublicFields(leadId);
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (error) {
    console.error('Error getting lead:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get unlock stats for a lead
router.get('/leads/:leadId/stats', async (req, res) => {
  try {
    const { leadId } = req.params;
    const stats = await LeadProcessor.getUnlockStats(leadId);
    res.json(stats);
  } catch (error) {
    console.error('Error getting lead stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get provider unlocks
router.get('/providers/:providerId/unlocks', async (req, res) => {
  try {
    const { providerId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        u.*,
        l.service_type,
        l.city,
        l.created_at as lead_created_at
      FROM unlocks u
      JOIN leads l ON u.lead_id = l.lead_id
      WHERE u.provider_id = $1
    `;
    
    const params = [parseInt(providerId)];
    
    if (status) {
      query += ` AND u.status = $${params.length + 1}`;
      params.push(status);
    }
    
    query += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const pool = require('../config/database');
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting provider unlocks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Database health check
router.get('/health/db', async (req, res) => {
  try {
    const pool = require('../config/database');
    const result = await pool.query('SELECT NOW()');
    
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(500).json({ 
      status: 'unhealthy', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

module.exports = router;
