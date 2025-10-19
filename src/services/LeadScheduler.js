const moment = require('moment-timezone');
const pool = require('../config/database');

class LeadScheduler {
  constructor() {
    // TEMPORARY: 24/7 business hours for testing
    this.defaultBusinessHours = {
      start: 0, // 12 AM (midnight)
      end: 24,  // 12 AM next day (24:00 = always open)
      timezone: 'America/New_York', // Eastern Time
      days: [1, 2, 3, 4, 5, 6, 7] // Monday-Sunday (1=Monday, 7=Sunday)
    };
  }

  /**
   * Check if current time is within business hours
   */
  isBusinessHours(timezone = this.defaultBusinessHours.timezone) {
    const now = moment().tz(timezone);
    const hour = now.hour();
    const day = now.isoWeekday(); // 1=Monday, 7=Sunday
    
    const { start, end, days } = this.defaultBusinessHours;
    
    const isValidDay = days.includes(day);
    const isValidHour = hour >= start && hour < end;
    
    console.log(`Business hours check: Current time in ${timezone}: ${now.format('YYYY-MM-DD HH:mm:ss z')}`);
    console.log(`Hour: ${hour}, Day: ${day}, Valid day: ${isValidDay}, Valid hour: ${isValidHour} (${start}-${end})`);
    console.log(`Is business hours: ${isValidDay && isValidHour}`);
    
    return isValidDay && isValidHour;
  }

  /**
   * Get next business hour timestamp
   */
  getNextBusinessHour(timezone = this.defaultBusinessHours.timezone) {
    const now = moment().tz(timezone);
    let nextBusinessTime = now.clone();
    
    // If we're in business hours, return current time
    if (this.isBusinessHours(timezone)) {
      return now.toDate();
    }
    
    // If after business hours today, schedule for tomorrow morning
    if (now.hour() >= this.defaultBusinessHours.end) {
      nextBusinessTime = now.clone().add(1, 'day').hour(this.defaultBusinessHours.start).minute(0).second(0);
    } else {
      // If before business hours today, schedule for this morning
      nextBusinessTime = now.clone().hour(this.defaultBusinessHours.start).minute(0).second(0);
    }
    
    // Skip weekends if not in allowed days
    while (!this.defaultBusinessHours.days.includes(nextBusinessTime.isoWeekday())) {
      nextBusinessTime = nextBusinessTime.add(1, 'day');
    }
    
    console.log(`Next business hour scheduled for: ${nextBusinessTime.format('YYYY-MM-DD HH:mm:ss z')} (${timezone})`);
    
    return nextBusinessTime.toDate();
  }

  /**
   * Ensure scheduled_leads table exists
   */
  async ensureScheduledLeadsTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_leads (
        id SERIAL PRIMARY KEY,
        lead_id VARCHAR(255) NOT NULL,
        provider_id VARCHAR(50) NOT NULL,
        scheduled_for TIMESTAMP NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL,
        UNIQUE(lead_id, provider_id)
      )
    `);
  }

  /**
   * Schedule a lead for processing
   */
  async scheduleLeadProcessing(leadId, providerId, scheduledFor = null) {
    try {
      const scheduleTime = scheduledFor || this.getNextBusinessHour();
      
      // Create scheduled_leads table if it doesn't exist
      await this.ensureScheduledLeadsTable();
      
      // Insert scheduled lead
      const result = await pool.query(`
        INSERT INTO scheduled_leads (lead_id, provider_id, scheduled_for, status)
        VALUES ($1, $2, $3, 'pending')
        ON CONFLICT (lead_id, provider_id) 
        DO UPDATE SET scheduled_for = $3, status = 'pending'
        RETURNING *
      `, [leadId, providerId, scheduleTime]);
      
      console.log(`Lead ${leadId} scheduled for provider ${providerId} at ${scheduleTime}`);
      return result.rows[0];
      
    } catch (error) {
      console.error('Error scheduling lead:', error);
      throw error;
    }
  }

  /**
   * Process all pending scheduled leads that are due
   */
  async processPendingScheduledLeads() {
    try {
      // Ensure the scheduled_leads table exists
      await this.ensureScheduledLeadsTable();
      
      const now = new Date();
      
      // Get all pending scheduled leads that are due
      const result = await pool.query(`
        SELECT * FROM scheduled_leads 
        WHERE status = 'pending' 
        AND scheduled_for <= $1
        ORDER BY scheduled_for ASC
      `, [now]);
      
      console.log(`Found ${result.rows.length} scheduled leads to process`);
      
      for (const scheduledLead of result.rows) {
        try {
          await this.processScheduledLead(scheduledLead);
        } catch (error) {
          console.error(`Error processing scheduled lead ${scheduledLead.id}:`, error);
          // Mark as failed but continue with others
          await pool.query(`
            UPDATE scheduled_leads 
            SET status = 'failed', processed_at = NOW() 
            WHERE id = $1
          `, [scheduledLead.id]);
        }
      }
      
    } catch (error) {
      console.error('Error processing pending scheduled leads:', error);
      throw error;
    }
  }

  /**
   * Process a single scheduled lead
   */
  async processScheduledLead(scheduledLead) {
    const LeadProcessor = require('./LeadProcessor');
    
    try {
      console.log(`Processing scheduled lead: ${scheduledLead.lead_id} for provider ${scheduledLead.provider_id}`);
      
      // Process the lead normally
      await LeadProcessor.processProviderMatch(
        scheduledLead.lead_id,
        { provider_id: scheduledLead.provider_id, match_score: 100 },
        null, // leadData will be fetched by processProviderMatch
        null  // enhancement
      );
      
      // Mark as processed
      await pool.query(`
        UPDATE scheduled_leads 
        SET status = 'processed', processed_at = NOW() 
        WHERE id = $1
      `, [scheduledLead.id]);
      
      console.log(`Successfully processed scheduled lead ${scheduledLead.id}`);
      
    } catch (error) {
      console.error(`Error in processScheduledLead:`, error);
      throw error;
    }
  }

  /**
   * Start the scheduler (runs every 5 minutes)
   */
  startScheduler() {
    console.log('Starting lead scheduler...');
    
    // Process immediately on start
    this.processPendingScheduledLeads().catch(error => {
      console.error('Error in initial scheduled leads processing:', error);
    });
    
    // Then process every 5 minutes
    this.schedulerInterval = setInterval(() => {
      this.processPendingScheduledLeads().catch(error => {
        console.error('Error in scheduled leads processing:', error);
      });
    }, 5 * 60 * 1000); // 5 minutes
    
    console.log('Lead scheduler started - checking every 5 minutes');
  }

  /**
   * Stop the scheduler
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      console.log('Lead scheduler stopped');
    }
  }

  /**
   * Get scheduled leads status
   */
  async getScheduledLeadsStatus() {
    try {
      // Ensure table exists first
      await this.ensureScheduledLeadsTable();
      
      const result = await pool.query(`
        SELECT 
          status,
          COUNT(*) as count,
          MIN(scheduled_for) as next_scheduled,
          MAX(scheduled_for) as last_scheduled
        FROM scheduled_leads 
        GROUP BY status
      `);
      
      return result.rows;
    } catch (error) {
      console.error('Error getting scheduled leads status:', error);
      throw error;
    }
  }
}

module.exports = new LeadScheduler();
