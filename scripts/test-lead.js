require('dotenv').config();
const Lead = require('../src/models/Lead');
const LeadProcessor = require('../src/services/LeadProcessor');

async function testLead() {
  try {
    console.log('Creating test lead...');
    
    // Sample lead data matching FluentForms structure
    const testLeadData = {
      name: 'John Smith',
      phone: '+1234567890',
      cityzip: 'Miami 33101',
      date_time: '2024-10-20 14:00:00',
      length: '60 minutes',
      type: 'Massage Therapy',
      location: 'Client Location',
      contactpref: 'Phone Call'
    };

    // Create the lead
    const lead = await Lead.create(testLeadData);
    console.log('Created lead:', lead.lead_id);

    // Process the lead (this will match providers and send SMS)
    console.log('Processing lead...');
    await LeadProcessor.processNewLead(lead.lead_id);

    console.log('Test completed! Check your SMS for notifications.');

  } catch (error) {
    console.error('Error testing lead:', error);
  }
}

if (require.main === module) {
  testLead();
}

module.exports = testLead;
