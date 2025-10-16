const Lead = require('../models/Lead');
const Unlock = require('../models/Unlock');
const Provider = require('../models/Provider');
const OpenAIService = require('./OpenAIService');
const SMSService = require('./SMSService');
const StripeService = require('./StripeService');

class LeadProcessor {
  static async processNewLead(leadId) {
    try {
      console.log(`Processing new lead: ${leadId}`);

      // Get lead data
      const lead = await Lead.findById(leadId);
      if (!lead) {
        throw new Error(`Lead not found: ${leadId}`);
      }

      // Validate lead quality with OpenAI
      const qualityCheck = await OpenAIService.validateLeadQuality(lead);
      console.log('Lead quality check:', qualityCheck);

      if (!qualityCheck.should_process) {
        console.log('Lead quality too low, skipping processing');
        return;
      }

      // Find matching providers
      const allProviders = await Provider.findMatchingProviders(lead);
      if (allProviders.length === 0) {
        console.log('No providers found for lead');
        return;
      }

      // Use OpenAI to match providers
      const matchingResult = await OpenAIService.processLeadForMatching(lead, allProviders);
      console.log('Provider matching result:', matchingResult);

      // Get public lead data for teaser
      const publicLeadData = await Lead.getPublicFields(leadId);

      // Enhance the teaser with OpenAI
      const teaserEnhancement = await OpenAIService.generateTeaserEnhancement(publicLeadData);

      // Process each matched provider
      for (const match of matchingResult.matches) {
        await LeadProcessor.processProviderMatch(leadId, match, publicLeadData, teaserEnhancement);
      }

      console.log(`Lead processing completed for ${leadId}`);

    } catch (error) {
      console.error('Error processing new lead:', error);
      throw error;
    }
  }

  static async processProviderMatch(leadId, match, leadData, enhancement) {
    try {
      const providerId = match.provider_id;
      console.log(`Processing match for provider ${providerId} with score ${match.match_score}`);

      // Get provider details
      const provider = await Provider.findById(providerId);
      if (!provider) {
        console.error(`Provider not found: ${providerId}`);
        return;
      }

      // Check if provider is opted out
      if (provider.sms_opted_out) {
        console.log(`Provider ${providerId} is opted out, skipping`);
        return;
      }

      // Check rate limiting
      const rateLimitInfo = await Provider.getRateLimitInfo(providerId);
      if (rateLimitInfo.isRateLimited) {
        console.log(`Provider ${providerId} is rate limited, skipping`);
        return;
      }

      // Check if lead is closed
      const isLeadClosed = await Unlock.isLeadClosed(leadId);
      if (isLeadClosed) {
        console.log(`Lead ${leadId} is closed, skipping provider ${providerId}`);
        return;
      }

      // Create unlock record
      const unlock = await Unlock.create(leadId, providerId);

      // Check quiet hours
      if (SMSService.isQuietHours(provider.phone)) {
        console.log(`Quiet hours for provider ${providerId}, scheduling for later`);
        // In production, you'd queue this for later processing
        // For now, we'll continue but log it
      }

      const now = new Date().toISOString();

      // Send teaser SMS
      await SMSService.sendTeaserMessage(provider.phone, leadData, leadId);

      // Update unlock status with audit trail
      await Unlock.updateStatus(leadId, providerId, 'TEASER_SENT', {
        teaser_sent_at: now,
        last_sent_at: now
      });

      console.log(`Teaser sent to provider ${providerId} for lead ${leadId}`);

    } catch (error) {
      console.error('Error processing provider match:', error);
      throw error;
    }
  }

  static async handleProviderResponse(phoneNumber, message, leadId = null) {
    try {
      console.log(`Processing provider response from ${phoneNumber}: ${message}`);

      const result = await SMSService.processIncomingMessage(phoneNumber, message, leadId);
      console.log('SMS processing result:', result);

      return result;

    } catch (error) {
      console.error('Error handling provider response:', error);
      throw error;
    }
  }

  static async processExpiredUnlocks() {
    try {
      console.log('Processing expired unlocks...');

      const expiredUnlocks = await Unlock.findExpiredUnlocks();
      
      for (const unlock of expiredUnlocks) {
        await Unlock.updateStatus(
          unlock.lead_id, 
          unlock.provider_id, 
          'EXPIRED'
        );
        console.log(`Expired unlock: Lead ${unlock.lead_id}, Provider ${unlock.provider_id}`);
      }

      console.log(`Processed ${expiredUnlocks.length} expired unlocks`);

      // Also process expired leads
      const expiredLeads = await Lead.findExpiredLeads();
      for (const lead of expiredLeads) {
        await Lead.closeLead(lead.lead_id);
        console.log(`Closed expired lead: ${lead.lead_id}`);
      }

      console.log(`Closed ${expiredLeads.length} expired leads`);

    } catch (error) {
      console.error('Error processing expired unlocks:', error);
      throw error;
    }
  }

  static async getProviderById(providerId) {
    return await Provider.findById(providerId);
  }

  static async getUnlockStats(leadId) {
    try {
      const pool = require('../config/database');
      const result = await pool.query(`
        SELECT 
          status,
          COUNT(*) as count
        FROM unlocks 
        WHERE lead_id = $1 
        GROUP BY status
      `, [leadId]);

      const stats = {};
      result.rows.forEach(row => {
        stats[row.status] = parseInt(row.count);
      });

      return stats;
    } catch (error) {
      console.error('Error getting unlock stats:', error);
      throw error;
    }
  }

  static async retryFailedPaymentReveal(checkoutSessionId) {
    try {
      console.log(`Retrying payment reveal for session: ${checkoutSessionId}`);

      const unlock = await Unlock.findByCheckoutSession(checkoutSessionId);
      if (!unlock) {
        throw new Error('Unlock not found for checkout session');
      }

      // Verify payment is actually completed
      const isPaymentValid = await StripeService.verifyPayment(checkoutSessionId);
      if (!isPaymentValid) {
        throw new Error('Payment not confirmed by Stripe');
      }

      // Get lead and provider details
      const leadDetails = await Lead.getPrivateFields(unlock.lead_id);
      const publicDetails = await Lead.getPublicFields(unlock.lead_id);
      const provider = await Provider.findById(unlock.provider_id);

      if (leadDetails && provider) {
        // Send reveal SMS
        await SMSService.sendRevealDetails(provider.phone, leadDetails, publicDetails, unlock.lead_id);

        // Update status with audit trail
        const now = new Date().toISOString();
        await Unlock.updateStatus(
          unlock.lead_id, 
          unlock.provider_id, 
          'REVEALED',
          { revealed_at: now }
        );

        console.log(`Successfully retried reveal for session: ${checkoutSessionId}`);
        return true;
      }

      return false;

    } catch (error) {
      console.error('Error retrying payment reveal:', error);
      throw error;
    }
  }

  // Cleanup old unlocks (run periodically)
  static async cleanupOldUnlocks(daysOld = 30) {
    try {
      const pool = require('../config/database');
      const result = await pool.query(`
        DELETE FROM unlocks 
        WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'
        AND status IN ('EXPIRED', 'DECLINED', 'REVEALED')
      `);

      console.log(`Cleaned up ${result.rowCount} old unlocks`);
      return result.rowCount;

    } catch (error) {
      console.error('Error cleaning up old unlocks:', error);
      throw error;
    }
  }
}

module.exports = LeadProcessor;
