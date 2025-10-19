const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class Lead {
  static async create(leadData) {
    const {
      name, phone, cityzip, date_time, length, type, 
      location, contactpref, email = null
    } = leadData;

    // Extract city and zip from cityzip field
    let city = cityzip.replace(/\d+/g, '').trim();
    const zip_code = cityzip.match(/\d+/) ? cityzip.match(/\d+/)[0] : null;
    
    // If no city name (only zip code entered), use zip as city for display
    if (!city && zip_code) {
      city = zip_code;
    }
    
    // Build exact address from available data
    const exact_address = `${cityzip}${location ? `, ${location}` : ''}`;
    
    // Create notes snippet (max 160 chars, no PII)
    const notes_snippet = `${type} session${length ? ` (${length})` : ''}${contactpref ? `, prefers ${contactpref}` : ''}`.substring(0, 160);

    const query = `
      INSERT INTO leads (
        city, service_type, preferred_time_window, session_length, location_type, notes_snippet,
        client_name, client_phone, client_email, exact_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      city, type, date_time, length, location, notes_snippet,
      name, phone, email, exact_address
    ];
    
    console.log('Lead creation values:', {
      city, 
      service_type: type, 
      preferred_time_window: date_time, 
      session_length: length, 
      location_type: location, 
      notes_snippet,
      client_name: name, 
      client_phone: phone, 
      client_email: email, 
      exact_address
    });

    try {
      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating lead:', error);
      throw error;
    }
  }

  static async findById(leadId) {
    const query = 'SELECT * FROM leads WHERE lead_id = $1';
    try {
      const result = await pool.query(query, [leadId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error finding lead:', error);
      throw error;
    }
  }

  static async getPublicFields(leadId) {
    const query = `
      SELECT 
        lead_id,
        city,
        service_type,
        preferred_time_window,
        session_length,
        location_type,
        budget_range,
        notes_snippet,
        created_at,
        expires_at,
        is_closed
      FROM leads 
      WHERE lead_id = $1
    `;
    
    try {
      const result = await pool.query(query, [leadId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error getting public lead fields:', error);
      throw error;
    }
  }

  static async getPrivateFields(leadId) {
    const query = `
      SELECT 
        client_name,
        client_phone,
        client_email,
        exact_address,
        city
      FROM leads 
      WHERE lead_id = $1
    `;
    
    try {
      const result = await pool.query(query, [leadId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error getting private lead fields:', error);
      throw error;
    }
  }

  static async findMatchingProviders(leadId) {
    const query = `
      SELECT id, name, phone
      FROM providers 
    `;
    
    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error finding matching providers:', error);
      throw error;
    }
  }

  static async closeLead(leadId) {
    const query = `
      UPDATE leads 
      SET is_closed = true, updated_at = CURRENT_TIMESTAMP
      WHERE lead_id = $1
      RETURNING *
    `;

    try {
      const result = await pool.query(query, [leadId]);
      return result.rows[0];
    } catch (error) {
      console.error('Error closing lead:', error);
      throw error;
    }
  }

  static async findExpiredLeads() {
    const query = `
      SELECT * FROM leads 
      WHERE expires_at < CURRENT_TIMESTAMP 
      AND is_closed = false
    `;

    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Error finding expired leads:', error);
      throw error;
    }
  }
}

module.exports = Lead;
