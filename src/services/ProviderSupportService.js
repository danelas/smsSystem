const OpenAI = require('openai');

class ProviderSupportService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.systemInstructions = `SYSTEM - Gold Touch Provider Support

ROLE
You are Gold Touch Provider Support. You answer questions from service providers about how Gold Touch works.

PRIMARY GOAL
Give short, clear, friendly answers that build trust and guide providers. Default to the most helpful action that moves the provider forward.

BRAND VOICE
Warm, respectful, confident, practical. No hype. No pressure. Keep messages short. Use simple sentences.

LEGAL AND POLICY RULES
- Gold Touch is a directory and lead platform. Gold Touch does not perform or arrange services.
- Providers are independent. They set their own prices, schedules, and payment methods.
- No medical or legal advice.
- Do not promise bookings or income.
- Do not use the phrase "Book Now" unless the provider has instant booking enabled. Prefer "Contact Provider", "Request Info", or "Check Availability".
- Refunds - use limited refund language only. Unlock fees are non-refundable once contact details are revealed. Memberships are non-refundable after digital access begins, except billing errors or duplicate charges.
- Privacy: never reveal client personal info unless the provider has unlocked that specific request and is the intended recipient.

SMS FORMATTING RULES
- SMS: max 2 to 4 short lines.
- Never paste long URLs if you can use a short branded link.
- Lead equals client request. Use human language: "client request" or "client inquiry".
- Unlock equals pay to view client contact details.
- No time limit to accept. Providers can unlock whenever they want, unless a request expires or is claimed out.

COMMON RESPONSES
Location: "We cater to all of Florida."
Commission: "No. You keep 100% of what you earn."
For skepticism: "Totally understand. You only pay if you choose to unlock. We send you a short preview first. No subscriptions required."
Request frequency: "It varies by city and hours. In active areas you can see a few each week. Turn on more service areas to receive more."

BUSINESS MODEL BENEFITS
You can mention when appropriate: "It's a great model - if you accept and chat with the customer you could have a repeat customer for only $20."

Never reveal any client data before an unlock is confirmed for that provider.`;
  }

  /**
   * Detect if a provider message is a question vs a lead response
   */
  isProviderQuestion(message) {
    const questionIndicators = [
      '?', 'how', 'what', 'when', 'where', 'why', 'who',
      'help', 'info', 'explain', 'tell me', 'understand',
      'work', 'cost', 'price', 'fee', 'charge', 'pay',
      'location', 'area', 'commission', 'cut', 'earn',
      'often', 'many', 'request', 'lead', 'client', 'question',
      'cancel', 'cancellation', 'unsubscribe', 'stop service', 'quit',
      'plan', 'subscription', 'account', 'billing', 'support',
      'hello', 'hi', 'hey', 'trying to', 'need to', 'want to',
      'issue', 'problem', 'trouble', 'site', 'website', 'see'
    ];

    const leadResponseIndicators = [
      'y', 'yes', 'n', 'no', 'interested', 'pass', 'skip'
    ];

    const lowerMessage = message.toLowerCase().trim();
    
    console.log(`[Provider Support] Analyzing message: "${message}"`);
    console.log(`[Provider Support] Lower message: "${lowerMessage}"`);
    
    // If it's a clear lead response, not a question
    // Use word boundaries to avoid matching single letters within words
    const isLeadResponse = leadResponseIndicators.some(indicator => {
      // For single letters like 'y' or 'n', require exact match
      if (indicator.length === 1) {
        return lowerMessage === indicator;
      }
      // For longer words, allow includes but with word boundaries
      return lowerMessage === indicator || 
             lowerMessage.includes(` ${indicator} `) || 
             lowerMessage.startsWith(`${indicator} `) || 
             lowerMessage.endsWith(` ${indicator}`);
    });
    
    if (isLeadResponse) {
      console.log(`[Provider Support] Detected as lead response - matched indicators:`, 
        leadResponseIndicators.filter(indicator => lowerMessage === indicator || lowerMessage.includes(indicator)));
      return false;
    }

    // If it contains question indicators, likely a question
    const hasQuestionIndicator = questionIndicators.some(indicator => 
      lowerMessage.includes(indicator)
    );
    
    console.log(`[Provider Support] Has question indicator: ${hasQuestionIndicator}`);
    console.log(`[Provider Support] Question indicators found:`, questionIndicators.filter(indicator => lowerMessage.includes(indicator)));
    
    return hasQuestionIndicator;
  }

  /**
   * Get AI response for provider question
   */
  async getProviderSupportResponse(providerMessage, providerPhone = null) {
    try {
      const messages = [
        {
          role: 'system',
          content: this.systemInstructions
        },
        {
          role: 'user',
          content: `Provider question: ${providerMessage}`
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: messages,
        max_tokens: 100, // Keep responses very short for SMS
        temperature: 0.7
      });

      const aiResponse = response.choices[0].message.content.trim();
      
      // Log for debugging
      console.log(`Provider Support AI Response for ${providerPhone}:`, aiResponse);
      
      return aiResponse;

    } catch (error) {
      console.error('Error getting AI response:', error);
      
      // Fallback response
      return `Thanks for your question! For immediate help, visit goldtouchmobile.com or reply with specific questions about how Gold Touch works.`;
    }
  }

  /**
   * Handle provider message - determine if it's a question and respond appropriately
   */
  async handleProviderMessage(phoneNumber, message) {
    try {
      // Check if this looks like a question
      if (this.isProviderQuestion(message)) {
        console.log(`Detected provider question from ${phoneNumber}: ${message}`);
        
        // Get AI response
        const aiResponse = await this.getProviderSupportResponse(message, phoneNumber);
        
        return {
          isQuestion: true,
          response: aiResponse,
          action: 'ai_support_response'
        };
      }

      // Not a question, handle as normal lead response
      return {
        isQuestion: false,
        action: 'process_lead_response'
      };

    } catch (error) {
      console.error('Error handling provider message:', error);
      return {
        isQuestion: false,
        action: 'process_lead_response'
      };
    }
  }
}

module.exports = new ProviderSupportService();
