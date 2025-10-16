const express = require('express');
const router = express.Router();

// Success page after payment
router.get('/success', (req, res) => {
  const { lead_id, provider_id } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Successful - Gold Touch Leads</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .success-icon {
                font-size: 48px;
                color: #28a745;
                margin-bottom: 20px;
            }
            .lead-id {
                background: #e9ecef;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                margin: 20px 0;
            }
            .footer {
                margin-top: 30px;
                font-size: 14px;
                color: #666;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✅</div>
            <h1>Payment Successful!</h1>
            <p>Thank you for your payment. The lead contact details have been sent to your phone via SMS.</p>
            
            ${lead_id ? `<div class="lead-id">Lead ID: ${lead_id}</div>` : ''}
            
            <p><strong>What happens next?</strong></p>
            <ul style="text-align: left; display: inline-block;">
                <li>Check your phone for the contact details SMS</li>
                <li>Contact the client directly using the provided information</li>
                <li>Follow up professionally and promptly</li>
            </ul>
            
            <div class="footer">
                <p>Gold Touch provides advertising access to client inquiries.<br>
                We do not arrange or guarantee appointments.</p>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Cancel page
router.get('/cancel', (req, res) => {
  const { lead_id } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Payment Cancelled - Gold Touch Leads</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px; 
                text-align: center;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                padding: 40px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .cancel-icon {
                font-size: 48px;
                color: #dc3545;
                margin-bottom: 20px;
            }
            .lead-id {
                background: #e9ecef;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                margin: 20px 0;
            }
            .footer {
                margin-top: 30px;
                font-size: 14px;
                color: #666;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="cancel-icon">❌</div>
            <h1>Payment Cancelled</h1>
            <p>Your payment was cancelled. No charges have been made to your account.</p>
            
            ${lead_id ? `<div class="lead-id">Lead ID: ${lead_id}</div>` : ''}
            
            <p>If you change your mind, you can still reply <strong>Y</strong> to the original SMS to get a new payment link.</p>
            
            <div class="footer">
                <p>Gold Touch - Lead opportunities delivered to your phone</p>
            </div>
        </div>
    </body>
    </html>
  `);
});

module.exports = router;
