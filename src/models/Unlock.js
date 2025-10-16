const pool = require('../config/database');
const moment = require('moment-timezone');

class Unlock {
  static async create(leadId, providerId, ttlHours = 24) {
    const idempotencyKey = `unlock_${leadId}_${providerId}`;
    const ttlExpiresAt = moment().add(ttlHours, 'hours').toISOString();

    const query = `
      INSERT INTO unlocks (
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
      console.error('Error creating unlock:', error);
      throw error;
    }
  }

  static async updateStatus(leadId, providerId, status, auditData = {}) {
    let query = `
      UPDATE unlocks 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
    `;
    let values = [status, leadId, providerId];
    let paramCount = 1;

    // Add audit trail fields
    const auditFields = [
      'payment_link_url', 'checkout_session_id', 'unlocked_at', 'last_sent_at',
      'teaser_sent_at', 'y_received_at', 'payment_link_sent_at', 'paid_at', 'revealed_at'
    ];

    auditFields.forEach(field => {
      if (auditData[field] !== undefined) {
        paramCount++;
        query += `, ${field} = $${paramCount}`;
        values.splice(-2, 0, auditData[field]);
      }
    });

    query += ` WHERE lead_id = $${paramCount + 1} AND provider_id = $${paramCount + 2} RETURNING *`;

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating unlock status:', error);
      throw error;
    }
  }

  static async findByLeadAndProvider(leadId, providerId) {
    const query = `
      SELECT * FROM unlocks 
      WHERE lead_id = $1 AND provider_id = $2
    `;

    try {
      const result = await pool.query(query, [leadId, providerId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding unlock:', error);
      throw error;
    }
  }

  static async findByCheckoutSession(checkoutSessionId) {
    const query = `
      SELECT * FROM unlocks 
      WHERE checkout_session_id = $1
    `;

    try {
      const result = await pool.query(query, [checkoutSessionId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding unlock by checkout session:', error);
      throw error;
    }
  }

  static async findExpiredUnlocks() {
    const query = `
      SELECT * FROM unlocks 
      WHERE status IN ('TEASER_SENT', 'AWAIT_CONFIRM') 
      AND ttl_expires_at < CURRENT_TIMESTAMP
    `;

    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error finding expired unlocks:', error);
      throw error;
    }
  }

  static async findRevealedUnlocks(leadId, providerId) {
    const query = `
      SELECT * FROM unlocks 
      WHERE lead_id = $1 AND provider_id = $2 
      AND status = 'REVEALED'
    `;

    try {
      const result = await pool.query(query, [leadId, providerId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding revealed unlock:', error);
      throw error;
    }
  }

  static async handlePaymentAfterTTL(checkoutSessionId) {
    try {
      const unlock = await this.findByCheckoutSession(checkoutSessionId);
      if (!unlock) {
        throw new Error('Unlock not found for checkout session');
      }

      // Check if already revealed
      if (unlock.status === 'REVEALED') {
        console.log('Unlock already revealed, skipping');
        return { action: 'already_revealed', unlock };
      }

      // Even if TTL expired, reveal since they paid
      const now = new Date().toISOString();
      await this.updateStatus(unlock.lead_id, unlock.provider_id, 'PAID', {
        paid_at: now,
        unlocked_at: now
      });

      // Mark lead as closed to prevent new unlocks if desired
      await pool.query(
        'UPDATE leads SET is_closed = true WHERE lead_id = $1',
        [unlock.lead_id]
      );

      return { action: 'reveal_after_ttl', unlock };

    } catch (error) {
      console.error('Error handling payment after TTL:', error);
      throw error;
    }
  }

  static async handleDuplicatePayment(leadId, providerId, newCheckoutSessionId) {
    try {
      const existingUnlock = await this.findRevealedUnlocks(leadId, providerId);
      
      if (existingUnlock) {
        console.log('Duplicate payment detected for already revealed unlock');
        
        // Log the duplicate payment attempt
        await pool.query(`
          INSERT INTO unlock_audit_log (
            lead_id, provider_id, event_type, checkout_session_id, notes, created_at
          ) VALUES ($1, $2, 'DUPLICATE_PAYMENT', $3, 'Payment after already revealed', CURRENT_TIMESTAMP)
        `, [leadId, providerId, newCheckoutSessionId]);

        return { 
          action: 'duplicate_payment', 
          message: 'already_unlocked',
          existingUnlock 
        };
      }

      return { action: 'no_duplicate' };

    } catch (error) {
      console.error('Error handling duplicate payment:', error);
      throw error;
    }
  }

  static async getIdempotencyKey(leadId, providerId) {
    return `unlock_${leadId}_${providerId}`;
  }

  static async getProviderUnlockCount(providerId, timeWindow = '1 hour') {
    const query = `
      SELECT COUNT(*) as count
      FROM unlocks 
      WHERE provider_id = $1 
      AND created_at > CURRENT_TIMESTAMP - INTERVAL '${timeWindow}'
    `;

    try {
      const result = await pool.query(query, [providerId]);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error('Error getting provider unlock count:', error);
      throw error;
    }
  }

  static async isLeadClosed(leadId) {
    const query = 'SELECT is_closed FROM leads WHERE lead_id = $1';
    
    try {
      const result = await pool.query(query, [leadId]);
      return result.rows[0]?.is_closed || false;
    } catch (error) {
      console.error('Error checking if lead is closed:', error);
      return false;
    }
  }
}

module.exports = Unlock;
