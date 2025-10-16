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
    const message = `🔓 Ready to unlock this lead? Pay $20 to get full contact details: ${paymentUrl}

Lead ID: ${leadId}

This is an advertising access fee, not a service booking. Gold Touch provides advertising access to client inquiries. We do not arrange or guarantee appointments.`;
    
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
    const timeWindow = leadData.preferred_time_window ? 
      moment(leadData.preferred_time_window).format('MMM D, YYYY h:mm A') : 
      'Flexible';

    return `📋 BOOKING REQUEST AVAILABLE
Service: ${leadData.service_type}
Location: ${leadData.city}
When: ${timeWindow}
Session: ${leadData.session_length || 'Not specified'}
Contact Pref: ${leadData.contact_preference || 'Not specified'}

💰 Unlock full contact details for $20
Reply Y to proceed, N to pass

Lead ID: ${leadId}

Gold Touch provides advertising access to client inquiries. We do not arrange or guarantee appointments.`;
  }

  formatRevealMessage(privateDetails, publicDetails, leadId) {
    return `🔓 LEAD UNLOCKED - Contact Details

👤 Client: ${privateDetails.client_name}
📞 Phone: ${privateDetails.client_phone}
📧 Email: ${privateDetails.client_email || 'Not provided'}
📍 Address: ${privateDetails.exact_address || `${privateDetails.city}, ${privateDetails.zip_code || ''}`}

Service: ${publicDetails.service_type}
When: ${publicDetails.preferred_time_window ? moment(publicDetails.preferred_time_window).format('MMM D, YYYY h:mm A') : 'Flexible'}

Lead ID: ${leadId}

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
    
    // Normalize message: uppercase and trim spaces
    const message = messageBody.trim().toUpperCase();
    
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
        console.log('Unknown provider phone number:', phoneNumber);
        return { action: 'unknown_provider' };
      }
      
      console.log('Found provider:', JSON.stringify(provider, null, 2));

      // Check rate limiting
      const rateLimitInfo = await Provider.getRateLimitInfo(provider.provider_id);
      if (rateLimitInfo.isRateLimited) {
        console.log(`Provider ${provider.provider_id} is rate limited`);
        return { action: 'rate_limited' };
      }

      // If no leadId provided, try to find the most recent interaction
      if (!leadId) {
        console.log(`No leadId provided, looking for most recent unlock for provider: ${provider.provider_id}`);
        const recentUnlock = await this.getMostRecentUnlock(provider.provider_id);
        console.log('Most recent unlock found:', recentUnlock);
        
        if (!recentUnlock) {
          console.log('No recent unlock found - sending help message');
          await this.sendHelpMessage(phoneNumber);
          return { action: 'no_recent_interaction' };
        }
        leadId = recentUnlock.lead_id;
        console.log('Using leadId from recent unlock:', leadId);
      }

      console.log(`Looking for unlock with leadId: ${leadId}, providerId: ${provider.provider_id}`);
      const unlock = await Unlock.findByLeadAndProvider(leadId, provider.provider_id);
      console.log('Found unlock:', unlock);
      
      if (!unlock) {
        console.log('No unlock found - sending help message');
        await this.sendHelpMessage(phoneNumber);
        return { action: 'unlock_not_found' };
      }

      // Handle responses based on current status and normalized message
      if (unlock.status === 'TEASER_SENT' || unlock.status === 'AWAIT_CONFIRM') {
        if (message === 'Y' || message === 'YES') {
          // Record Y received timestamp
          const now = new Date().toISOString();
          await Unlock.updateStatus(leadId, provider.provider_id, 'AWAIT_CONFIRM', {
            y_received_at: now
          });

          // Check if lead is closed
          const isLeadClosed = await Unlock.isLeadClosed(leadId);
          if (isLeadClosed) {
            await this.sendSMS(phoneNumber, "This lead is no longer available. Thank you for your interest!");
            return { action: 'lead_closed' };
          }

          // Create or reuse payment link
          console.log('Creating payment link for lead:', leadId, 'provider:', provider.provider_id);
          const paymentUrl = await StripeService.createPaymentLink(leadId, provider.provider_id, provider.email);
          console.log('Payment URL generated:', paymentUrl);
          
          if (!paymentUrl) {
            console.error('Failed to generate payment URL');
            await this.sendSMS(phoneNumber, "Sorry, there was an issue generating the payment link. Please try again later.");
            return { action: 'payment_error' };
          }
          
          await this.sendPaymentLink(phoneNumber, paymentUrl, leadId);
          
          await Unlock.updateStatus(leadId, provider.provider_id, 'PAYMENT_LINK_SENT', {
            payment_link_sent_at: now,
            last_sent_at: now
          });

          return { action: 'payment_link_sent', paymentUrl };
          
        } else if (message === 'N' || message === 'NO') {
          await Unlock.updateStatus(leadId, provider.provider_id, 'EXPIRED');
          await this.sendSMS(phoneNumber, "Thanks for letting us know. You'll receive future lead opportunities.");
          return { action: 'declined' };
        }
      }

      // For any unrecognized response, send helper message
      await this.sendHelpMessage(phoneNumber);
      return { action: 'unrecognized_response' };

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
}

module.exports = new SMSService();
