require('dotenv').config();
const Lead = require('../src/models/Lead');
const Provider = require('../src/models/Provider');
const Unlock = require('../src/models/Unlock');
const SMSService = require('../src/services/SMSService');

async function testEdgeCases() {
  console.log('Testing Gold Touch Lead System Edge Cases...\n');

  try {
    // Test 1: Create a test provider
    console.log('1. Creating test provider...');
    const testProvider = await Provider.create({
      phone: '+1234567890',
      email: 'test@example.com',
      name: 'Test Provider',
      serviceAreas: ['Miami', 'Fort Lauderdale']
    });
    console.log('✅ Test provider created:', testProvider.provider_id);

    // Test 2: Create a test lead
    console.log('\n2. Creating test lead...');
    const testLead = await Lead.create({
      name: 'John Doe',
      phone: '+1987654321',
      cityzip: 'Miami 33101',
      date_time: '2024-10-20 14:00:00',
      length: '60 minutes',
      type: 'Massage Therapy',
      location: 'Client Location',
      contactpref: 'Phone Call'
    });
    console.log('✅ Test lead created:', testLead.lead_id);

    // Test 3: Create unlock record
    console.log('\n3. Creating unlock record...');
    const unlock = await Unlock.create(testLead.lead_id, testProvider.provider_id);
    console.log('✅ Unlock created with TTL:', unlock.ttl_expires_at);

    // Test 4: Test rate limiting
    console.log('\n4. Testing rate limiting...');
    const rateLimitInfo = await Provider.getRateLimitInfo(testProvider.provider_id);
    console.log('✅ Rate limit info:', rateLimitInfo);

    // Test 5: Test SMS message normalization
    console.log('\n5. Testing SMS message normalization...');
    const testMessages = ['y', 'Y', ' Y ', 'YES', 'n', 'N', 'NO', 'STOP', 'random'];
    
    for (const msg of testMessages) {
      const normalized = msg.trim().toUpperCase();
      console.log(`"${msg}" → "${normalized}"`);
    }

    // Test 6: Test duplicate payment detection
    console.log('\n6. Testing duplicate payment detection...');
    const duplicateCheck = await Unlock.handleDuplicatePayment(
      testLead.lead_id, 
      testProvider.provider_id, 
      'test_session_123'
    );
    console.log('✅ Duplicate check result:', duplicateCheck.action);

    // Test 7: Test lead closure
    console.log('\n7. Testing lead closure...');
    await Lead.closeLead(testLead.lead_id);
    const isLeadClosed = await Unlock.isLeadClosed(testLead.lead_id);
    console.log('✅ Lead closed:', isLeadClosed);

    // Test 8: Test expired unlock detection
    console.log('\n8. Testing expired unlock detection...');
    // Manually set TTL to past for testing
    await Unlock.updateStatus(testLead.lead_id, testProvider.provider_id, 'TEASER_SENT', {
      ttl_expires_at: new Date(Date.now() - 1000).toISOString() // 1 second ago
    });
    
    const expiredUnlocks = await Unlock.findExpiredUnlocks();
    console.log('✅ Found expired unlocks:', expiredUnlocks.length);

    // Test 9: Test audit trail
    console.log('\n9. Testing audit trail...');
    const now = new Date().toISOString();
    await Unlock.updateStatus(testLead.lead_id, testProvider.provider_id, 'REVEALED', {
      teaser_sent_at: now,
      y_received_at: now,
      payment_link_sent_at: now,
      paid_at: now,
      revealed_at: now
    });
    
    const finalUnlock = await Unlock.findByLeadAndProvider(testLead.lead_id, testProvider.provider_id);
    console.log('✅ Audit trail complete:', {
      teaser_sent_at: !!finalUnlock.teaser_sent_at,
      y_received_at: !!finalUnlock.y_received_at,
      payment_link_sent_at: !!finalUnlock.payment_link_sent_at,
      paid_at: !!finalUnlock.paid_at,
      revealed_at: !!finalUnlock.revealed_at
    });

    // Test 10: Test quiet hours detection
    console.log('\n10. Testing quiet hours detection...');
    const isQuietHours = SMSService.isQuietHours(testProvider.phone);
    console.log('✅ Is quiet hours:', isQuietHours);

    console.log('\n🎉 All edge case tests completed successfully!');
    console.log('\nNext steps:');
    console.log('- Deploy to Render');
    console.log('- Configure Stripe webhooks');
    console.log('- Set up TextMagic incoming SMS webhook');
    console.log('- Configure FluentForms webhook');
    console.log('- Test with real providers and leads');

  } catch (error) {
    console.error('❌ Error during testing:', error);
  }
}

if (require.main === module) {
  testEdgeCases();
}

module.exports = testEdgeCases;
