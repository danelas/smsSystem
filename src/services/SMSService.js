const axios = require('axios');
const moment = require('moment-timezone');

class SMSService {
  constructor() {
    this.username = process.env.TEXTMAGIC_USERNAME;
    this.apiKey = process.env.TEXTMAGIC_API_KEY;
    this.fromNumber = process.env.TEXTMAGIC_FROM_NUMBER;
    this.baseUrl = 'https://rest.textmagic.com/api/v2';
    this.smsBridgeUrl = process.env.SMS_BRIDGE_URL;
  }

  async sendSMS(phoneNumber, message) {
    try {
      // Clean phone number (remove any non-digits except +)
      const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
      
      const response = await axios.post(`${this.baseUrl}/messages`, {
        text: message,
        phones: cleanPhone
      }, {
        auth: {
          username: this.username,
          password: this.apiKey
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log('SMS sent successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending SMS:', error.response?.data || error.message);
      throw error;
    }
  }

  async sendTeaserMessage(providerPhone, leadData, leadId) {
    const message = this.formatTeaserMessage(leadData, leadId);
    
    // Check quiet hours before sending
    if (this.isQuietHours(providerPhone)) {
      console.log('Quiet hours detected, queueing message for later');
      // In a production system, you'd queue this message
      // For now, we'll just log and continue
    }

    return await this.sendSMS(providerPhone, message);
  }

  async sendPaymentLink(providerPhone, paymentUrl, leadId) {
    // Create a shorter redirect URL
    const shortUrl = `https://smssystem.onrender.com/unlocks/pay/${leadId.substring(0, 8)}`;
    
    const message = `🔓 Pay $20 to unlock lead: ${shortUrl}`;
    
    console.log('Payment SMS length:', message.length);
    console.log('Original Stripe URL length:', paymentUrl.length);
    console.log('Short URL length:', shortUrl.length);
    
    return await this.sendSMS(providerPhone, message);
  }

  async sendRevealDetails(providerPhone, privateDetails, publicDetails, leadId) {
    const message = this.formatRevealMessage(privateDetails, publicDetails, leadId);
    return await this.sendSMS(providerPhone, message);
  }

  async sendOptOutConfirmation(providerPhone) {
    const message = "✅ You've been opted out from Gold Touch notifications. Reply START to opt back in.";
    return await this.sendSMS(providerPhone, message);
  }

  formatTeaserMessage(leadData, leadId) {
    // Debug: Log the leadData being passed to SMS formatter
    console.log('SMS Formatter - leadData received:', JSON.stringify(leadData, null, 2));
    
    // Format date without time since form only collects date
    // Handle both string dates from forms and Date objects from database
    let timeWindow = 'Flexible';
    if (leadData.preferred_time_window) {
      let parsedDate;
      
      // Convert to string if it's a Date object
      const dateValue = typeof leadData.preferred_time_window === 'string' 
        ? leadData.preferred_time_window 
        : leadData.preferred_time_window.toString();
      
      // Try to parse different date formats
      if (dateValue.includes('.')) {
        // Handle m.d.Y format (10.19.2025)
        parsedDate = moment(dateValue, 'M.D.YYYY');
      } else if (dateValue.includes('/')) {
        // Handle m/d/Y format (10/19/2025)
        parsedDate = moment(dateValue, 'M/D/YYYY');
      } else {
        // Fallback to default parsing (handles ISO dates from database)
        parsedDate = moment(leadData.preferred_time_window);
      }
      
      if (parsedDate.isValid()) {
        timeWindow = parsedDate.format('MMM D, YYYY');
      } else {
        timeWindow = dateValue; // Use as-is if parsing fails
      }
    }

    // Show contact preference info if available
    let contactInfo = '';
    if (leadData.contactpref) {
      contactInfo = `Contact Pref: ${leadData.contactpref}`;
      if (leadData.contactpref === 'Email' && leadData.email) {
        contactInfo += ` (${leadData.email})`;
      }
    }

    return `📋 GOLD TOUCH CLIENT REQUEST AVAILABLE
Service: ${leadData.service_type}
Location: ${leadData.city}
When: ${timeWindow}
Session: ${leadData.session_length || leadData.length || 'Not specified'}
${contactInfo ? contactInfo + '\n' : ''}
💰 Unlock full contact details for $20
Reply Y to proceed, N to pass

Gold Touch provides advertising access to client inquiries. We do not arrange or guarantee appointments.`;
  }

  formatRevealMessage(privateDetails, publicDetails, leadId) {
    return `🔓 Client Request Unlocked

👤 Client: ${privateDetails.client_name}
📞 Phone: ${privateDetails.client_phone}
📧 Email: ${privateDetails.client_email || 'Not provided'}
📍 Address: ${privateDetails.exact_address || `${privateDetails.city}, ${privateDetails.zip_code || ''}`}
💬 Contact Pref: ${publicDetails.contactpref || 'Not specified'}

Service: ${publicDetails.service_type}
When: ${publicDetails.preferred_time_window ? moment(publicDetails.preferred_time_window).format('MMM D, YYYY h:mm A') : 'Flexible'}

Contact the client directly. Good luck! 🍀`;
  }

  isQuietHours(phoneNumber) {
    // For now, assume all providers are in the same timezone
    // In production, you'd lookup the provider's timezone from the database
    const now = moment().tz('America/New_York'); // Default timezone
    const hour = now.hour();
    const minute = now.minute();
    
    // Quiet hours: 21:30 (9:30 PM) to 08:00 (8:00 AM)
    const isAfterQuietStart = hour > 21 || (hour === 21 && minute >= 30);
    const isBeforeQuietEnd = hour < 8;
    
    return isAfterQuietStart || isBeforeQuietEnd;
  }

  async processIncomingMessage(phoneNumber, messageBody, leadId = null) {
    const Unlock = require('../models/Unlock');
    const Provider = require('../models/Provider');
    const StripeService = require('./StripeService');
    const ProviderSupportService = require('./ProviderSupportService');
    
    // Keep original message for AI processing
    const originalMessage = messageBody.trim();
    // Normalize message for lead responses: uppercase and trim spaces
    const message = originalMessage.toUpperCase();
    
    try {
      // Handle STOP requests
      if (message === 'STOP') {
        await this.handleOptOut(phoneNumber);
        return { action: 'opted_out' };
      }

      // Handle START requests (opt back in)
      if (message === 'START') {
        await this.handleOptIn(phoneNumber);
        return { action: 'opted_in' };
      }

      const provider = await Provider.findByPhone(phoneNumber);
      if (!provider) {
        console.log('Unknown phone number:', phoneNumber);
        await this.handleUnknownNumber(phoneNumber);
        return { action: 'unknown_number_auto_responded' };
      }

      // Check if this is a provider support question
      const supportResult = await ProviderSupportService.handleProviderMessage(phoneNumber, originalMessage);
      
      if (supportResult.isQuestion) {
        // Send AI-generated support response
        await this.sendSMS(phoneNumber, supportResult.response);
        return { action: 'ai_support_response', response: supportResult.response };
      }
      
      console.log('Found provider:', JSON.stringify(provider, null, 2));

      // Check rate limiting  
      const providerId = provider.id || provider.provider_id;
      const rateLimitInfo = await Provider.getRateLimitInfo(providerId);
      if (rateLimitInfo.isRateLimited) {
        console.log(`Provider ${providerId} is rate limited`);
        return { action: 'rate_limited' };
      }

      // If no leadId provided, try to find the most recent interaction
      if (!leadId) {
        console.log(`No leadId provided, looking for most recent unlock for provider: ${providerId}`);
        const recentUnlock = await this.getMostRecentUnlock(providerId);
        console.log('Most recent unlock found:', recentUnlock);
        
        if (!recentUnlock) {
          console.log('No recent unlock found - sending help message');
          await this.sendHelpMessage(phoneNumber);
          return { action: 'no_recent_interaction' };
        }
        leadId = recentUnlock.lead_id;
        console.log('Using leadId from recent unlock:', leadId);
      }

      console.log(`Looking for unlock with leadId: ${leadId}, providerId: ${providerId}`);
      const unlock = await Unlock.findByLeadAndProvider(leadId, providerId);
      console.log('Found unlock:', unlock);
      
      if (!unlock) {
        console.log('No unlock found - sending help message');
        await this.sendHelpMessage(phoneNumber);
        return { action: 'unlock_not_found' };
      }

      // Handle responses based on current status and normalized message
      if (unlock.status === 'TEASER_SENT' || unlock.status === 'AWAIT_CONFIRM' || unlock.status === 'NEW_LEAD' || unlock.status === 'PAYMENT_LINK_SENT') {
        if (message === 'Y' || message === 'YES') {
          // Record Y received timestamp
          const now = new Date().toISOString();
          await Unlock.updateStatus(leadId, providerId, 'AWAIT_CONFIRM', {
            y_received_at: now
          });

          // Check if lead is closed
          const isLeadClosed = await Unlock.isLeadClosed(leadId);
          if (isLeadClosed) {
            await this.sendSMS(phoneNumber, "This lead is no longer available. Thank you for your interest!");
            return { action: 'lead_closed' };
          }

          // Create or reuse payment link
          console.log('Creating payment link for lead:', leadId, 'provider:', providerId);
          console.log('Current unlock status:', unlock.status);
          console.log('Existing payment link URL:', unlock.payment_link_url);
          
          const paymentUrl = await StripeService.createPaymentLink(leadId, providerId, provider.email);
          console.log('Payment URL generated:', paymentUrl);
          
          if (!paymentUrl) {
            console.error('Failed to generate payment URL');
            await this.sendSMS(phoneNumber, "Sorry, there was an issue generating the payment link. Please try again later.");
            return { action: 'payment_error' };
          }
          
          await this.sendPaymentLink(phoneNumber, paymentUrl, leadId);
          
          await Unlock.updateStatus(leadId, providerId, 'PAYMENT_LINK_SENT', {
            payment_link_sent_at: now,
            last_sent_at: now
          });

          return { action: 'payment_link_sent', paymentUrl };
          
        } else if (message === 'N' || message === 'NO') {
          await Unlock.updateStatus(leadId, providerId, 'EXPIRED');
          await this.sendSMS(phoneNumber, "Thanks for letting us know. You'll receive future lead opportunities.");
          return { action: 'declined' };
        }
      }

      // Only send help message if it looks like they're trying to respond to a lead
      // Don't send help for casual greetings or random messages
      const looksLikeLeadResponse = /^[yn]|yes|no|interested|maybe|sure|ok/i.test(message.trim());
      
      if (looksLikeLeadResponse) {
        await this.sendHelpMessage(phoneNumber);
        return { action: 'unrecognized_response_with_help' };
      }
      
      // For casual messages like "hi", "hello", etc. - just log and ignore
      console.log(`Ignoring casual message from provider ${providerId}: "${message}"`);
      return { action: 'ignored_casual_message' };

    } catch (error) {
      console.error('Error processing incoming message:', error);
      throw error;
    }
  }

  async sendHelpMessage(phoneNumber) {
    const message = "Reply Y to unlock for $20. Reply N to skip. Reply STOP to opt out.";
    return await this.sendSMS(phoneNumber, message);
  }

  async handleOptOut(phoneNumber) {
    const Provider = require('../models/Provider');
    try {
      await Provider.updateOptOutStatus(phoneNumber, true);
      await this.sendOptOutConfirmation(phoneNumber);
    } catch (error) {
      console.error('Error handling opt-out:', error);
      throw error;
    }
  }

  async handleOptIn(phoneNumber) {
    const Provider = require('../models/Provider');
    try {
      await Provider.updateOptOutStatus(phoneNumber, false);
      await this.sendSMS(phoneNumber, "✅ You're now opted back in to Gold Touch Lead notifications!");
    } catch (error) {
      console.error('Error handling opt-in:', error);
      throw error;
    }
  }

  async getMostRecentUnlock(providerId) {
    const pool = require('../config/database');
    try {
      const result = await pool.query(
        'SELECT * FROM unlocks WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 1',
        [providerId]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error getting most recent unlock:', error);
      throw error;
    }
  }

  async handleUnknownNumber(phoneNumber) {
    try {
      // Check if we've already sent the auto-responder to this number
      const pool = require('../config/database');
      
      // Create table for tracking auto-responses if it doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS auto_responses (
          phone VARCHAR(20) PRIMARY KEY,
          first_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          response_sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Check if we've already responded to this number in the last 24 hours
      const existingResponse = await pool.query(
        'SELECT * FROM auto_responses WHERE phone = $1 AND response_sent_at > NOW() - INTERVAL \'24 hours\'',
        [phoneNumber]
      );
      
      if (existingResponse.rows.length > 0) {
        console.log(`Already sent auto-response to ${phoneNumber} within last 24 hours, ignoring`);
        return { action: 'already_responded_today' };
      }
      
      // Send the auto-response message
      const autoResponseMessage = "Hi! Thanks for contacting Gold Touch.\nVisit goldtouchmobile.com to browse verified wellness providers and contact them directly for your session.";
      
      await this.sendSMS(phoneNumber, autoResponseMessage);
      
      // Record that we've sent the auto-response (update timestamp if exists)
      await pool.query(
        'INSERT INTO auto_responses (phone, response_sent_at) VALUES ($1, NOW()) ON CONFLICT (phone) DO UPDATE SET response_sent_at = NOW()',
        [phoneNumber]
      );
      
      console.log(`Sent auto-response to unknown number: ${phoneNumber}`);
      return { action: 'auto_response_sent' };
      
    } catch (error) {
      console.error('Error handling unknown number:', error);
      throw error;
    }
  }
}

module.exports = new SMSService();
