const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Store recent logs in memory for easy access
const recentLogs = [];
const MAX_LOGS = 1000;

// Log storage function
function addLog(level, message, meta = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    meta
  };
  
  recentLogs.unshift(logEntry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.pop();
  }
  
  // Also log to console
  console.log(`[${logEntry.timestamp}] ${level.toUpperCase()}: ${message}`, meta);
}

// Expose log function globally
global.systemLog = addLog;

// Get recent logs endpoint
router.get('/logs', (req, res) => {
  const { level, limit = 100, search } = req.query;
  
  let filteredLogs = recentLogs;
  
  // Filter by level
  if (level) {
    filteredLogs = filteredLogs.filter(log => log.level === level);
  }
  
  // Search in message
  if (search) {
    filteredLogs = filteredLogs.filter(log => 
      log.message.toLowerCase().includes(search.toLowerCase()) ||
      JSON.stringify(log.meta).toLowerCase().includes(search.toLowerCase())
    );
  }
  
  // Limit results
  filteredLogs = filteredLogs.slice(0, parseInt(limit));
  
  res.json({
    success: true,
    total_logs: recentLogs.length,
    filtered_count: filteredLogs.length,
    logs: filteredLogs
  });
});

// Test webhook connectivity
router.get('/test-webhook', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint is reachable',
    timestamp: new Date().toISOString(),
    server_time: new Date().toLocaleString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Investigate payment issues for a specific provider
router.get('/payment-issue/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const { hours = 24 } = req.query;
    
    console.log(`Investigating payment issues for provider: ${providerId}`);
    
    // Get all unlocks for this provider in the last X hours
    const unlocksQuery = `
      SELECT 
        u.*,
        l.client_name,
        l.service_type,
        l.city,
        l.created_at as lead_created_at
      FROM unlocks u
      LEFT JOIN leads l ON u.lead_id = l.lead_id
      WHERE u.provider_id = $1 
      AND u.created_at >= NOW() - INTERVAL '${hours} hours'
      ORDER BY u.created_at DESC
    `;
    
    const unlocks = await pool.query(unlocksQuery, [providerId]);
    
    // Get audit logs for this provider
    const auditQuery = `
      SELECT * FROM unlock_audit_log 
      WHERE provider_id = $1 
      AND created_at >= NOW() - INTERVAL '${hours} hours'
      ORDER BY created_at DESC
    `;
    
    let auditLogs = [];
    try {
      const auditResult = await pool.query(auditQuery, [providerId]);
      auditLogs = auditResult.rows;
    } catch (auditError) {
      console.log('Audit log table may not exist:', auditError.message);
    }
    
    // Analyze each unlock for potential issues
    const analysis = [];
    
    for (const unlock of unlocks.rows) {
      const issues = [];
      const timeline = [];
      
      // Timeline analysis
      if (unlock.teaser_sent_at) timeline.push({ event: 'Teaser Sent', time: unlock.teaser_sent_at });
      if (unlock.y_received_at) timeline.push({ event: 'Y Response', time: unlock.y_received_at });
      if (unlock.payment_link_sent_at) timeline.push({ event: 'Payment Link Sent', time: unlock.payment_link_sent_at });
      if (unlock.paid_at) timeline.push({ event: 'Payment Completed', time: unlock.paid_at });
      if (unlock.revealed_at) timeline.push({ event: 'Details Revealed', time: unlock.revealed_at });
      
      // Check for issues
      if (unlock.paid_at && !unlock.revealed_at) {
        issues.push('CRITICAL: Payment completed but details never revealed');
      }
      
      if (unlock.ttl_expires_at && unlock.paid_at) {
        const ttlExpired = new Date(unlock.ttl_expires_at) < new Date(unlock.paid_at);
        if (ttlExpired) {
          issues.push('Payment made after TTL expiration');
        }
      }
      
      if (unlock.status === 'PAID' && !unlock.revealed_at) {
        issues.push('Status is PAID but no reveal timestamp');
      }
      
      // Check time gaps
      if (unlock.y_received_at && unlock.payment_link_sent_at) {
        const responseTime = new Date(unlock.payment_link_sent_at) - new Date(unlock.y_received_at);
        if (responseTime > 5 * 60 * 1000) { // 5 minutes
          issues.push(`Long delay between Y response and payment link: ${Math.round(responseTime / 60000)} minutes`);
        }
      }
      
      if (unlock.paid_at && unlock.payment_link_sent_at) {
        const paymentDelay = new Date(unlock.paid_at) - new Date(unlock.payment_link_sent_at);
        if (paymentDelay > 2 * 60 * 60 * 1000) { // 2 hours
          issues.push(`Long delay between payment link and payment: ${Math.round(paymentDelay / 3600000)} hours`);
        }
      }
      
      analysis.push({
        lead_id: unlock.lead_id,
        client_name: unlock.client_name,
        service_type: unlock.service_type,
        status: unlock.status,
        issues: issues,
        timeline: timeline.sort((a, b) => new Date(a.time) - new Date(b.time)),
        checkout_session_id: unlock.checkout_session_id,
        ttl_expires_at: unlock.ttl_expires_at
      });
    }
    
    res.json({
      success: true,
      provider_id: providerId,
      period: `Last ${hours} hours`,
      total_unlocks: unlocks.rows.length,
      unlocks_with_issues: analysis.filter(a => a.issues.length > 0).length,
      analysis: analysis,
      audit_logs: auditLogs,
      summary: {
        paid_but_not_revealed: analysis.filter(a => 
          a.timeline.some(t => t.event === 'Payment Completed') && 
          !a.timeline.some(t => t.event === 'Details Revealed')
        ).length,
        ttl_expired_payments: analysis.filter(a => 
          a.issues.some(i => i.includes('TTL expiration'))
        ).length
      }
    });
    
  } catch (error) {
    console.error('Error investigating payment issue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to investigate payment issue',
      details: error.message
    });
  }
});

// Check specific lead and provider combination
router.get('/unlock-details/:leadId/:providerId', async (req, res) => {
  try {
    const { leadId, providerId } = req.params;
    
    // Get unlock details
    const unlockQuery = `
      SELECT u.*, l.*, p.name as provider_name, p.phone as provider_phone
      FROM unlocks u
      LEFT JOIN leads l ON u.lead_id = l.lead_id  
      LEFT JOIN providers p ON u.provider_id = p.id
      WHERE u.lead_id = $1 AND u.provider_id = $2
    `;
    
    const unlock = await pool.query(unlockQuery, [leadId, providerId]);
    
    if (unlock.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Unlock record not found'
      });
    }
    
    // Get audit logs if available
    let auditLogs = [];
    try {
      const auditQuery = `
        SELECT * FROM unlock_audit_log 
        WHERE lead_id = $1 AND provider_id = $2
        ORDER BY created_at DESC
      `;
      const auditResult = await pool.query(auditQuery, [leadId, providerId]);
      auditLogs = auditResult.rows;
    } catch (auditError) {
      console.log('Audit log not available:', auditError.message);
    }
    
    res.json({
      success: true,
      unlock_details: unlock.rows[0],
      audit_logs: auditLogs
    });
    
  } catch (error) {
    console.error('Error getting unlock details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unlock details'
    });
  }
});

// Manual fix for missed payments
router.post('/fix-missed-payment', async (req, res) => {
  try {
    const { leadId, providerId, checkoutSessionId } = req.body;
    
    if (!leadId || !providerId) {
      return res.status(400).json({
        success: false,
        error: 'leadId and providerId are required'
      });
    }
    
    console.log(`Manual fix for missed payment: ${leadId}, ${providerId}`);
    
    // Check if unlock exists and is in PAYMENT_LINK_SENT status
    const unlockQuery = `
      SELECT * FROM unlocks 
      WHERE lead_id = $1 AND provider_id = $2
    `;
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
    
    // Verify payment with Stripe if session ID provided
    let stripeVerified = false;
    if (checkoutSessionId) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
        
        if (session.payment_status === 'paid') {
          stripeVerified = true;
          console.log('Stripe payment verified:', session.payment_status);
        }
      } catch (stripeError) {
        console.error('Stripe verification failed:', stripeError.message);
      }
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
    
    // Log the manual fix
    try {
      await pool.query(`
        INSERT INTO unlock_audit_log (
          lead_id, provider_id, event_type, checkout_session_id, notes, created_at
        ) VALUES ($1, $2, 'MANUAL_FIX', $3, $4, CURRENT_TIMESTAMP)
      `, [leadId, providerId, checkoutSessionId, `Manual fix applied - payment verified: ${stripeVerified}`]);
    } catch (auditError) {
      console.log('Could not log to audit table:', auditError.message);
    }
    
    res.json({
      success: true,
      message: 'Payment issue fixed and lead details sent',
      stripe_verified: stripeVerified,
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
