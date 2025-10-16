require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔄 Connecting to database...');
    
    // Test connection
    const client = await pool.connect();
    console.log('✅ Connected to database successfully');
    
    // Read the schema file
    const schemaPath = path.join(__dirname, '../src/models/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('🔄 Creating database schema...');
    
    // Execute the schema
    await client.query(schema);
    
    console.log('✅ Database schema created successfully');
    
    // Check if we have any providers
    const providerCheck = await client.query('SELECT COUNT(*) FROM providers');
    const providerCount = parseInt(providerCheck.rows[0].count);
    
    console.log(`📊 Found ${providerCount} providers in database`);
    
    if (providerCount === 0) {
      console.log('🔄 Creating test providers...');
      
      // Create your existing providers
      const providers = [
        { name: 'Lisa', phone: '+17542806739', email: 'lisa@example.com' },
        { name: 'Nara', phone: '+13053169435', email: 'nara@example.com' },
        { name: 'Maylin', phone: '+13053180715', email: 'maylin@example.com' }
      ];
      
      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        await client.query(`
          INSERT INTO providers (name, phone, email, service_areas, is_verified)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          provider.name,
          provider.phone,
          provider.email,
          ['Miami', 'Hollywood', 'Fort Lauderdale'],
          true
        ]);
        console.log(`✅ Created provider: ${provider.name}`);
      }
    }
    
    // Show final provider list
    const finalProviders = await client.query('SELECT provider_id, name, phone FROM providers ORDER BY provider_id');
    console.log('\n📋 Current providers:');
    finalProviders.rows.forEach(p => {
      console.log(`   Provider ${p.provider_id}: ${p.name} (${p.phone})`);
    });
    
    client.release();
    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n🚀 Your system is ready to receive leads!');
    
  } catch (error) {
    console.error('❌ Error setting up database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupDatabase()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Setup failed:', error);
      process.exit(1);
    });
}

module.exports = setupDatabase;
