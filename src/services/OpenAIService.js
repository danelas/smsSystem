const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async processLeadForMatching(leadData, providers) {
    try {
      const prompt = this.buildMatchingPrompt(leadData, providers);
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are the Gold Touch Lead Matching Agent. Your job is to analyze client inquiries and match them with the most suitable service providers based on location, service type, and other relevant factors. Always respond with valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result;

    } catch (error) {
      console.error('Error processing lead with OpenAI:', error);
      throw error;
    }
  }

  buildMatchingPrompt(leadData, providers) {
    return `
Analyze this client inquiry and match it with suitable providers:

CLIENT INQUIRY:
- Service Type: ${leadData.service_type}
- Location: ${leadData.city}${leadData.zip_code ? `, ${leadData.zip_code}` : ''}
- Preferred Time: ${leadData.date_time || 'Flexible'}
- Session Length: ${leadData.session_length || 'Not specified'}
- Location Type: ${leadData.location_type || 'Not specified'}
- Contact Preference: ${leadData.contact_preference || 'Not specified'}

AVAILABLE PROVIDERS:
${providers.map(p => `
- ID: ${p.provider_id}
- Name: ${p.name}
- Service Areas: ${p.service_areas || 'Not specified'}
- Phone: ${p.phone}
`).join('')}

MATCHING CRITERIA:
1. Geographic proximity (same city/area)
2. Service type compatibility
3. Provider availability and capacity
4. Service area coverage

Respond with JSON in this format:
{
  "matches": [
    {
      "provider_id": 123,
      "match_score": 0.95,
      "match_reasons": ["Same city", "Exact service match", "Available in requested timeframe"],
      "priority": "high"
    }
  ],
  "summary": "Brief explanation of matching logic"
}

Match scores should be 0.0 to 1.0. Only include providers with score > 0.6.
Priority levels: "high" (0.9+), "medium" (0.7-0.89), "low" (0.6-0.69)
`;
  }

  async generateTeaserEnhancement(leadData) {
    try {
      const prompt = `
As the Gold Touch Lead Agent, enhance this lead summary for provider notifications:

LEAD DATA:
- Service: ${leadData.service_type}
- Location: ${leadData.city}
- Time: ${leadData.preferred_time_window || 'Flexible'}
- Session: ${leadData.session_length || 'Not specified'}
- Contact Pref: ${leadData.contact_preference || 'Not specified'}

Create an enhanced, professional summary that:
1. Highlights key selling points
2. Creates urgency without being pushy
3. Stays under 160 characters for the snippet
4. Maintains compliance (no PII revealed)

Respond with JSON:
{
  "enhanced_snippet": "Brief, compelling summary",
  "urgency_indicators": ["list", "of", "urgency", "factors"],
  "value_proposition": "Why this is a good lead"
}
`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are an expert at creating compelling, compliant lead summaries for service providers."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.4,
        max_tokens: 300
      });

      return JSON.parse(response.choices[0].message.content);

    } catch (error) {
      console.error('Error generating teaser enhancement:', error);
      return {
        enhanced_snippet: `${leadData.service_type} in ${leadData.city}`,
        urgency_indicators: [],
        value_proposition: "New client inquiry available"
      };
    }
  }

  async validateLeadQuality(leadData) {
    try {
      const prompt = `
Analyze this lead for quality and completeness:

LEAD DATA:
- Name: ${leadData.client_name ? 'Provided' : 'Missing'}
- Phone: ${leadData.client_phone ? 'Provided' : 'Missing'}
- Service: ${leadData.service_type}
- Location: ${leadData.city}
- Time: ${leadData.date_time || 'Not specified'}
- Session Length: ${leadData.session_length || 'Not specified'}
- Location Type: ${leadData.location_type || 'Not specified'}

Rate the lead quality and identify any issues:

Respond with JSON:
{
  "quality_score": 0.85,
  "quality_level": "high|medium|low",
  "missing_fields": ["list", "of", "missing", "important", "fields"],
  "red_flags": ["list", "of", "potential", "issues"],
  "recommendations": ["suggestions", "for", "improvement"],
  "should_process": true
}
`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a lead quality analyst. Evaluate leads for completeness, legitimacy, and commercial viability."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 400
      });

      return JSON.parse(response.choices[0].message.content);

    } catch (error) {
      console.error('Error validating lead quality:', error);
      return {
        quality_score: 0.7,
        quality_level: "medium",
        missing_fields: [],
        red_flags: [],
        recommendations: [],
        should_process: true
      };
    }
  }

  async generateFollowUpMessage(interactionHistory, currentStatus) {
    try {
      const prompt = `
Generate an appropriate follow-up message based on the interaction history:

CURRENT STATUS: ${currentStatus}
INTERACTION HISTORY: ${JSON.stringify(interactionHistory, null, 2)}

Create a professional, compliant follow-up message that:
1. Acknowledges the current situation
2. Provides clear next steps
3. Maintains professional tone
4. Includes compliance disclaimer

Respond with JSON:
{
  "message": "The follow-up message text",
  "message_type": "reminder|escalation|information|closing",
  "send_immediately": true|false,
  "delay_hours": 0
}
`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are the Gold Touch communication agent. Generate appropriate follow-up messages based on interaction context."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      });

      return JSON.parse(response.choices[0].message.content);

    } catch (error) {
      console.error('Error generating follow-up message:', error);
      return {
        message: "Thank you for your interest. Please let us know if you have any questions.",
        message_type: "information",
        send_immediately: false,
        delay_hours: 24
      };
    }
  }
}

module.exports = new OpenAIService();
