const https = require('https');

console.log('🔄 Setting up your database...');

const postData = '';

const options = {
  hostname: 'smssystem.onrender.com',
  port: 443,
  path: '/webhooks/setup/database',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.success) {
        console.log('✅ Database setup completed successfully!');
        console.log('🚀 Your system is now ready to receive leads!');
        console.log('\n📋 You can now test with:');
        console.log('   provider_id: "provider1" (Lisa)');
        console.log('   provider_id: "provider2" (Nara)');
        console.log('   provider_id: "provider3" (Maylin)');
      } else {
        console.log('❌ Setup failed:', response.error);
        console.log('Details:', response.details);
      }
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message);
});

req.write(postData);
req.end();
