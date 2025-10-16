const pool = require('../config/database');
const moment = require('moment-timezone');

class LeadProviderInteraction {
  static async create(leadId, providerId, ttlHours = 24) {
    const idempotencyKey = `unlock_${leadId}_${providerId}`;
    const ttlExpiresAt = moment().add(ttlHours, 'hours').toISOString();

    const query = `
      INSERT INTO lead_provider_interactions (
        lead_id, provider_id, status, idempotency_key, ttl_expires_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (lead_id, provider_id) 
      DO UPDATE SET 
        status = EXCLUDED.status,
        ttl_expires_at = EXCLUDED.ttl_expires_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [leadId, providerId, 'NEW_LEAD', idempotencyKey, ttlExpiresAt];

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating lead provider interaction:', error);
      throw error;
    }
  }

  static async updateStatus(leadId, providerId, status, additionalData = {}) {
    let query = `
      UPDATE lead_provider_interactions 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    let values = [status, leadId, providerId];
    let paramCount = 1;

    // Add optional fields
    if (additionalData.paymentLinkUrl) {
      paramCount++;
      query += `, payment_link_url = $${paramCount}`;
      values.splice(-2, 0, additionalData.paymentLinkUrl);
    }

    if (additionalData.checkoutSessionId) {
      paramCount++;
      query += `, checkout_session_id = $${paramCount}`;
      values.splice(-2, 0, additionalData.checkoutSessionId);
    }

    if (additionalData.unlockedAt) {
      paramCount++;
      query += `, unlocked_at = $${paramCount}`;
      values.splice(-2, 0, additionalData.unlockedAt);
    }

    if (additionalData.lastSentAt) {
      paramCount++;
      query += `, last_sent_at = $${paramCount}`;
      values.splice(-2, 0, additionalData.lastSentAt);
    }

    query += ` WHERE lead_id = $${paramCount + 1} AND provider_id = $${paramCount + 2} RETURNING *`;

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating interaction status:', error);
      throw error;
    }
  }

  static async findByLeadAndProvider(leadId, providerId) {
    const query = `
      SELECT * FROM lead_provider_interactions 
      WHERE lead_id = $1 AND provider_id = $2
    `;

    try {
      const result = await pool.query(query, [leadId, providerId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding interaction:', error);
      throw error;
    }
  }

  static async findByCheckoutSession(checkoutSessionId) {
    const query = `
      SELECT * FROM lead_provider_interactions 
      WHERE checkout_session_id = $1
    `;

    try {
      const result = await pool.query(query, [checkoutSessionId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding interaction by checkout session:', error);
      throw error;
    }
  }

  static async findExpiredInteractions() {
    const query = `
      SELECT * FROM lead_provider_interactions 
      WHERE status IN ('TEASER_SENT', 'AWAIT_CONFIRM') 
      AND ttl_expires_at < CURRENT_TIMESTAMP
    `;

    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error finding expired interactions:', error);
      throw error;
    }
  }

  static async getIdempotencyKey(leadId, providerId) {
    return `unlock_${leadId}_${providerId}`;
  }
}

module.exports = LeadProviderInteraction;
