const winston = require('winston');

// Create a logger with better formatting for Render
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
      let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      
      if (Object.keys(meta).length > 0) {
        log += ` | ${JSON.stringify(meta)}`;
      }
      
      if (stack) {
        log += `\nStack: ${stack}`;
      }
      
      return log;
    })
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    })
  ]
});

// Add helper methods for common logging patterns
logger.webhook = (type, data) => {
  logger.info(`WEBHOOK_${type.toUpperCase()}`, { webhook_data: data });
};

logger.payment = (action, leadId, providerId, details = {}) => {
  logger.info(`PAYMENT_${action.toUpperCase()}`, { 
    lead_id: leadId, 
    provider_id: providerId, 
    ...details 
  });
};

logger.sms = (action, phone, message = '') => {
  logger.info(`SMS_${action.toUpperCase()}`, { 
    phone: phone.substring(0, 6) + '***', // Mask phone for privacy
    message_length: message.length 
  });
};

logger.error_with_context = (message, error, context = {}) => {
  logger.error(message, {
    error_message: error.message,
    error_stack: error.stack,
    ...context
  });
};

module.exports = logger;
