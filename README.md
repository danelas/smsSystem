# Gold Touch Lead Unlock System

A comprehensive lead management system that integrates with FluentForms, Stripe payments, TextMagic SMS, and OpenAI to automatically process and distribute client inquiries to service providers.

## Features

- **FluentForms Integration**: Automatically processes form submissions from your website
- **Intelligent Lead Matching**: Uses OpenAI to match leads with the most suitable providers
- **SMS Notifications**: Sends teaser messages to providers via TextMagic
- **Stripe Payments**: Secure $20 payment processing for lead access
- **PII Protection**: Never reveals client contact details before payment
- **State Machine**: Robust workflow management with proper error handling
- **Compliance**: Built-in opt-out handling and quiet hours respect
- **Edge Case Handling**: Payment after TTL, duplicate payments, rate limiting
- **Comprehensive Audit Trail**: Full tracking of all interactions and payments
- **Lead Expiration**: Automatic closure of expired leads with 24-hour TTL

## Architecture

```
FluentForms → Webhook → Lead Processing → Provider Matching → SMS Teaser
                                                                    ↓
Payment Link ← SMS Response ← Provider Response ("Y")
     ↓
Stripe Payment → Webhook → Reveal Client Details → SMS to Provider
```

## Setup Instructions

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
# Database (your existing Render PostgreSQL)
DATABASE_URL=postgresql://providers_1foz_user:F397IAbZan3w01duRyVv8xKZWqDPFg7W@dpg-d31kvs6mcj7s738qhkb0-a/providers_1foz

# OpenAI
OPENAI_API_KEY=sk-...

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_API_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# TextMagic
TEXTMAGIC_API_KEY=your_api_key
TEXTMAGIC_FROM_NUMBER=+1234567890
TEXTMAGIC_USERNAME=your_username

# SMS Bridge
SMS_BRIDGE_URL=https://your-sms-bridge.com/webhook

# Application
WEBHOOK_SECRET=your_secure_webhook_secret
DOMAIN=https://your-app.onrender.com
```

### 2. Database Setup

Run the schema creation script on your existing database:

```sql
-- Run the contents of src/models/schema.sql
-- This will create the leads and lead_provider_interactions tables
```

### 3. Stripe Configuration

1. Create a Product in Stripe Dashboard
2. Add a fixed Price of $20.00 USD
3. Copy the Price ID to `STRIPE_PRICE_ID`
4. Set up webhook endpoint: `https://your-domain.com/webhooks/stripe`
5. Listen for `checkout.session.completed` events
6. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

### 4. TextMagic Configuration

1. Sign up for TextMagic account
2. Get API credentials from dashboard
3. Set up incoming webhook: `https://your-domain.com/webhooks/sms/incoming`

### 5. FluentForms Configuration

Set up a webhook in FluentForms to post to:
`https://your-domain.com/webhooks/fluentforms`

Include webhook secret header: `X-Webhook-Secret: your_webhook_secret`

### 6. Deploy to Render

1. Connect your GitHub repository to Render
2. Use the provided `render.yaml` for configuration
3. Set environment variables in Render dashboard
4. Deploy!

## API Endpoints

### Webhooks
- `POST /webhooks/fluentforms` - Receives form submissions
- `POST /webhooks/stripe` - Stripe payment confirmations
- `POST /webhooks/sms/incoming` - TextMagic incoming SMS
- `POST /webhooks/process-lead/:leadId` - Manual lead processing (testing)
- `POST /webhooks/cleanup/expired` - Process expired unlocks and leads

### API
- `GET /api/health` - Health check
- `GET /api/health/db` - Database health check
- `GET /api/leads/:leadId` - Get lead public details
- `GET /api/leads/:leadId/stats` - Get unlock statistics
- `GET /api/providers/:providerId/unlocks` - Provider unlock history

### Payment Pages
- `GET /unlocks/success` - Payment success page
- `GET /unlocks/cancel` - Payment cancelled page

## Database Schema

### Tables
- **providers**: Provider information and opt-out status
- **leads**: Client inquiries with PII protection
- **unlocks**: State tracking for lead-provider pairs
- **unlock_audit_log**: Comprehensive audit trail

### Key Fields
- **Audit Trail**: `teaser_sent_at`, `y_received_at`, `payment_link_sent_at`, `paid_at`, `revealed_at`
- **TTL Management**: `ttl_expires_at`, `expires_at`
- **Idempotency**: `idempotency_key` for preventing duplicate charges
- **Rate Limiting**: Tracked via unlock timestamps

## State Machine

The system follows this state flow:

1. **NEW_LEAD** → Lead created from FluentForms
2. **TEASER_SENT** → SMS teaser sent to matched providers
3. **AWAIT_CONFIRM** → Waiting for provider response
4. **PAYMENT_LINK_SENT** → Payment link sent after "Y" response
5. **AWAITING_PAYMENT** → Waiting for Stripe payment
6. **PAID** → Payment confirmed by Stripe
7. **REVEALED** → Client details sent to provider
8. **EXPIRED** → TTL expired without response
9. **DECLINED** → Provider responded "N"
10. **OPTED_OUT** → Provider sent "STOP"

## Edge Cases Handled

### Payment After TTL
- If a provider pays after the 24-hour TTL expires, the system still reveals the lead details since they paid
- The lead is automatically marked as closed to prevent new unlocks
- Full audit trail is maintained

### Duplicate Payments
- System detects if a provider tries to pay for the same lead twice
- Uses idempotency keys to prevent duplicate Stripe charges
- If duplicate payment occurs, sends "already unlocked" message and resends details
- Logs duplicate payment attempts in audit trail

### Rate Limiting
- Providers are limited to 10 messages per hour to prevent spam
- Rate limiting is checked before sending any SMS
- Configurable limits per provider

### Lead Expiration
- Leads automatically expire after 24 hours
- Expired leads are marked as closed
- No new unlocks can be created for expired leads

## Message Flow

### Teaser Message
```
🎯 NEW LEAD AVAILABLE
Service: Massage Therapy
Location: Miami
When: Oct 20, 2024 2:00 PM
Session: 60 minutes

💰 Unlock full contact details for $20
Reply Y to proceed, N to pass

Lead ID: abc123

Gold Touch List provides advertising access to client inquiries.
```

### Payment Link Message
```
🔓 Ready to unlock this lead? Pay $20 to get full contact details: 
https://checkout.stripe.com/...

Lead ID: abc123

This is an advertising access fee, not a service booking. Gold Touch List provides advertising access to client inquiries. We do not arrange or guarantee appointments.
```

### Reveal Message
```
🔓 LEAD UNLOCKED - Contact Details

👤 Client: John Smith
📞 Phone: (555) 123-4567
📧 Email: john@example.com
📍 Address: 123 Main St, Miami, FL 33101

Service: Massage Therapy
When: Oct 20, 2024 2:00 PM

Lead ID: abc123

Contact the client directly. Good luck! 🍀
```

## Security Features

- **PII Protection**: Client contact details never exposed before payment
- **Webhook Validation**: All webhooks validated with secrets
- **Rate Limiting**: API endpoints protected against abuse
- **Idempotency**: Prevents duplicate charges and processing
- **Input Validation**: All form data validated before processing

## Compliance Features

- **Opt-out Support**: Providers can text "STOP" to opt out
- **Quiet Hours**: No SMS sent between 9:30 PM - 8:00 AM
- **Legal Disclaimers**: All messages include compliance text
- **Audit Trail**: Complete interaction history maintained

## Monitoring

- Health check endpoints for uptime monitoring
- Comprehensive logging for debugging
- Error handling with proper HTTP status codes
- Database connection monitoring

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Start production server
npm start
```

## Support

For issues or questions, check the logs in your Render dashboard or contact support.

## License

Proprietary - Gold Touch Lead System
