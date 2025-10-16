const pool = require('../config/database');

class Provider {
  static async findById(providerId) {
    // Handle both numeric IDs and string IDs like "provider10"
    let query, params;
    
    if (typeof providerId === 'string' && providerId.startsWith('provider')) {
      // Use the string ID directly (like "provider10")
      query = 'SELECT * FROM providers WHERE id = $1';
      params = [providerId];
    } else {
      // Convert numeric ID to string format (10 -> "provider10")
      const stringId = `provider${providerId}`;
      query = 'SELECT * FROM providers WHERE id = $1';
      params = [stringId];
    }
    
    try {
      const result = await pool.query(query, params);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding provider:', error);
      throw error;
    }
  }

  static async findByPhone(phoneNumber) {
    // Normalize phone number - try multiple formats
    const cleanPhone = phoneNumber.replace(/[^\d]/g, ''); // Remove all non-digits
    
    // Try different phone number formats
    const phoneFormats = [
      phoneNumber, // Original format
      `+${cleanPhone}`, // Add + prefix
      `+1${cleanPhone.substring(1)}`, // Add +1 prefix if it starts with 1
      cleanPhone, // Just digits
      `1${cleanPhone}` // Add 1 prefix
    ];
    
    console.log('Trying phone formats:', phoneFormats);
    
    try {
      // Try each format
      for (const format of phoneFormats) {
        const query = 'SELECT * FROM providers WHERE phone = $1';
        const result = await pool.query(query, [format]);
        if (result.rows.length > 0) {
          console.log(`Found provider with phone format: ${format}`);
          return result.rows[0];
        }
      }
      
      console.log('No provider found with any phone format');
      return null;
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
      ORDER BY id
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

  static async findBySlug(slug) {
    const query = 'SELECT * FROM providers WHERE slug = $1';
    
    try {
      const result = await pool.query(query, [slug]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding provider by slug:', error);
      throw error;
    }
  }

  static async getAllWithUrls(baseUrl = '') {
    const query = `
      SELECT 
        id,
        name,
        phone,
        slug,
        created_at,
        updated_at
      FROM providers 
      ORDER BY name
    `;
    
    try {
      const result = await pool.query(query);
      return result.rows.map(provider => ({
        ...provider,
        form_url: `${baseUrl}/form/${provider.slug}`,
        profile_url: `${baseUrl}/provider/${provider.slug}`
      }));
    } catch (error) {
      console.error('Error getting all providers with URLs:', error);
      throw error;
    }
  }

  static generateSlug(name, providerId) {
    // Create URL-friendly slug from name
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .trim();
    
    // Extract numeric part from provider ID (provider1 -> 1)
    const numericId = typeof providerId === 'string' ? 
      providerId.replace('provider', '') : providerId;
    
    return `${baseSlug}-${numericId}`;
  }

  static async updateSlug(providerId, slug) {
    const query = `
      UPDATE providers 
      SET slug = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    try {
      const result = await pool.query(query, [slug, providerId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error updating provider slug:', error);
      throw error;
    }
  }
}

module.exports = Provider;
