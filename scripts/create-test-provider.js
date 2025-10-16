require('dotenv').config();
const Provider = require('../src/models/Provider');

async function createTestProvider() {
  try {
    console.log('Creating test provider with ID 10...');
    
    // Check if provider 10 already exists
    const existingProvider = await Provider.findById(10);
    if (existingProvider) {
      console.log('✅ Provider 10 already exists:', existingProvider);
      return;
    }

    // Create provider with specific ID (you might need to adjust this based on your database)
    const testProvider = await Provider.create({
      phone: '+1234567890',
      email: 'test.provider@example.com',
      name: 'Test Provider 10',
      serviceAreas: ['Miami', 'Fort Lauderdale', 'Boca Raton']
    });

    console.log('✅ Test provider created:', testProvider);
    
    // If the auto-generated ID isn't 10, we'll need to update it
    if (testProvider.provider_id !== 10) {
      console.log(`⚠️  Provider created with ID ${testProvider.provider_id}, not 10`);
      console.log('You may need to use provider_id:', testProvider.provider_id);
    }

  } catch (error) {
    console.error('❌ Error creating test provider:', error);
  }
}

if (require.main === module) {
  createTestProvider();
}

module.exports = createTestProvider;
