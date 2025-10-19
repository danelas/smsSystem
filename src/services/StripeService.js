// Ensure crypto module is available before initializing Stripe
const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto;
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Unlock = require('../models/Unlock');

class StripeService {
  static async createPaymentLink(leadId, providerId, providerEmail = null) {
    try {
      console.log('Stripe service: Creating payment link');
      console.log('- Lead ID:', leadId);
      console.log('- Provider ID:', providerId);
      console.log('- Stripe key configured:', !!process.env.STRIPE_SECRET_KEY);
      
      const idempotencyKey = await Unlock.getIdempotencyKey(leadId, providerId);

      // Check if there's already an active payment session
      const existingUnlock = await Unlock.findByLeadAndProvider(leadId, providerId);
      if (existingUnlock && existingUnlock.payment_link_url && 
          existingUnlock.status === 'PAYMENT_LINK_SENT') {
        console.log('Existing payment link found, returning existing URL');
        return existingUnlock.payment_link_url;
      }

      const sessionParams = {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Lead Contact Details Access',
                description: 'Unlock full client contact information for this lead',
              },
              unit_amount: 2000, // $20.00 in cents
            },
            quantity: 1,
          },
        ],
        metadata: {
          lead_id: leadId,
          provider_id: providerId.toString(),
          idempotency_key: idempotencyKey,
        },
        success_url: `${process.env.DOMAIN}/unlocks/success?lead_id=${leadId}&provider_id=${providerId}`,
        cancel_url: `${process.env.DOMAIN}/unlocks/cancel?lead_id=${leadId}`,
        expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      };

      // Add customer email if provided
      if (providerEmail) {
        sessionParams.customer_email = providerEmail;
      }

      // Create checkout session with idempotency key
      const session = await stripe.checkout.sessions.create(sessionParams, {
        idempotencyKey: idempotencyKey,
      });

      // Update the unlock with payment link
      await Unlock.updateStatus(leadId, providerId, 'PAYMENT_LINK_SENT', {
        payment_link_url: session.url,
        checkout_session_id: session.id,
        last_sent_at: new Date().toISOString()
      });

      return session.url;

    } catch (error) {
      console.error('Error creating Stripe payment link:', error);
      throw error;
    }
  }

  static async createPaymentLinkDirect(leadId, providerId) {
    try {
      const idempotencyKey = await Unlock.getIdempotencyKey(leadId, providerId);

      // Check for existing payment link
      const existingUnlock = await Unlock.findByLeadAndProvider(leadId, providerId);
      if (existingUnlock && existingUnlock.payment_link_url) {
        // Check if the link is still valid (not expired)
        try {
          const session = await stripe.checkout.sessions.retrieve(existingUnlock.checkout_session_id);
          if (session.status === 'open') {
            console.log('Existing valid payment link found');
            return existingUnlock.payment_link_url;
          }
        } catch (err) {
          console.log('Previous session expired or invalid, creating new one');
        }
      }

      // Create a Payment Link (alternative to Checkout Session)
      const paymentLink = await stripe.paymentLinks.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Lead Contact Details Access',
                description: 'Unlock full client contact information for this lead',
              },
              unit_amount: 2000, // $20.00 in cents
            },
            quantity: 1,
          },
        ],
        metadata: {
          lead_id: leadId,
          provider_id: providerId.toString(),
          idempotency_key: idempotencyKey,
        },
        after_completion: {
          type: 'redirect',
          redirect: {
            url: `${process.env.DOMAIN}/unlocks/success?lead_id=${leadId}&provider_id=${providerId}`,
          },
        },
      }, {
        idempotencyKey: idempotencyKey,
      });

      // Update the unlock
      await Unlock.updateStatus(leadId, providerId, 'PAYMENT_LINK_SENT', {
        payment_link_url: paymentLink.url,
        last_sent_at: new Date().toISOString()
      });

      return paymentLink.url;

    } catch (error) {
      console.error('Error creating Stripe payment link (direct):', error);
      throw error;
    }
  }

  static async verifyPayment(checkoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      return session.payment_status === 'paid';
    } catch (error) {
      console.error('Error verifying payment:', error);
      return false;
    }
  }

  static async getSessionMetadata(checkoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      return session.metadata;
    } catch (error) {
      console.error('Error getting session metadata:', error);
      return null;
    }
  }

  // Helper method to format price for display
  static formatPrice(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  static getPrice() {
    return 2000; // $20.00 in cents
  }
}

module.exports = StripeService;
