const pool = require('../config/database');

class Provider {
  static async findById(providerId) {
    const query = 'SELECT * FROM providers WHERE provider_id = $1';
    try {
      const result = await pool.query(query, [providerId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding provider:', error);
      throw error;
    }
  }

  static async findByPhone(phoneNumber) {
    // Normalize phone number
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
    const query = 'SELECT * FROM providers WHERE phone = $1';
    
    try {
      const result = await pool.query(query, [cleanPhone]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding provider by phone:', error);
      throw error;
    }
  }

  static async findMatchingProviders(leadData) {
    // Find providers that match the lead criteria and are not opted out
    const query = `
      SELECT * FROM providers 
      WHERE sms_opted_out = false 
      AND is_verified = true
      ORDER BY provider_id
    `;
    
    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error finding matching providers:', error);
      throw error;
    }
  }

  static async updateOptOutStatus(phoneNumber, optedOut) {
    const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
    const query = `
      UPDATE providers 
      SET sms_opted_out = $1, updated_at = CURRENT_TIMESTAMP
      WHERE phone = $2
      RETURNING *
    `;

    try {
      const result = await pool.query(query, [optedOut, cleanPhone]);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating opt-out status:', error);
      throw error;
    }
  }

  static async create(providerData) {
    const { phone, email, name, serviceAreas = [] } = providerData;
    const cleanPhone = phone.replace(/[^\d+]/g, '');

    const query = `
      INSERT INTO providers (phone, email, name, service_areas, is_verified)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [cleanPhone, email, name, serviceAreas, true];

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating provider:', error);
      throw error;
    }
  }

  static async getRateLimitInfo(providerId, windowMinutes = 60) {
    const query = `
      SELECT COUNT(*) as message_count
      FROM unlocks 
      WHERE provider_id = $1 
      AND last_sent_at > CURRENT_TIMESTAMP - INTERVAL '${windowMinutes} minutes'
    `;

    try {
      const result = await pool.query(query, [providerId]);
      return {
        messageCount: parseInt(result.rows[0].message_count),
        windowMinutes,
        isRateLimited: parseInt(result.rows[0].message_count) >= 10 // Max 10 messages per hour
      };
    } catch (error) {
      console.error('Error getting rate limit info:', error);
      return { messageCount: 0, windowMinutes, isRateLimited: false };
    }
  }

  static async isOptedOut(phoneNumber) {
    const provider = await this.findByPhone(phoneNumber);
    return provider?.sms_opted_out || false;
  }
}

module.exports = Provider;
