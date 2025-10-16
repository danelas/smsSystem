const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function setupYourDatabase() {
  const pool = new Pool({
    connectionString: 'postgresql://providers_1foz_user:F397IAbZan3w01duRyVv8xKZWqDPFg7W@dpg-d31kvs6mcj7s738qhkb0-a.virginia-postgres.render.com/providers_1foz',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Connecting to your PostgreSQL database...');
    
    const client = await pool.connect();
    console.log('✅ Connected successfully');
    
    // Check existing tables
    const existingTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log('📋 Existing tables:', existingTables.rows.map(r => r.table_name));
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, '../src/models/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('🔄 Adding Gold Touch Lead schema...');
    
    // Execute the schema (CREATE IF NOT EXISTS will handle existing tables)
    await client.query(schema);
    
    console.log('✅ Schema added successfully');
    
    // Check if providers table has data
    const providerCheck = await client.query('SELECT provider_id, name, phone FROM providers ORDER BY provider_id');
    
    console.log(`📊 Found ${providerCheck.rows.length} providers:`);
    providerCheck.rows.forEach(p => {
      console.log(`   Provider ${p.provider_id}: ${p.name} (${p.phone})`);
    });
    
    // If no providers, add your existing ones
    if (providerCheck.rows.length === 0) {
      console.log('🔄 Adding your providers...');
      
      const providers = [
        { name: 'Lisa', phone: '+17542806739', email: 'lisa@goldtouchleads.com' },
        { name: 'Nara', phone: '+13053169435', email: 'nara@goldtouchleads.com' },
        { name: 'Maylin', phone: '+13053180715', email: 'maylin@goldtouchleads.com' }
      ];
      
      for (const provider of providers) {
        const result = await client.query(`
          INSERT INTO providers (name, phone, email, service_areas, is_verified, sms_opted_out)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING provider_id, name
        `, [
          provider.name,
          provider.phone,
          provider.email,
          ['Miami', 'Hollywood', 'Fort Lauderdale', 'Boca Raton'],
          true,
          false
        ]);
        
        console.log(`✅ Added Provider ${result.rows[0].provider_id}: ${result.rows[0].name}`);
      }
    }
    
    // Final check
    const finalCheck = await client.query('SELECT provider_id, name, phone, sms_opted_out FROM providers ORDER BY provider_id');
    console.log('\n🎉 Setup complete! Your providers:');
    finalCheck.rows.forEach(p => {
      console.log(`   Provider ${p.provider_id}: ${p.name} (${p.phone}) - SMS: ${p.sms_opted_out ? 'OPTED OUT' : 'ACTIVE'}`);
    });
    
    console.log('\n📋 Tables created:');
    const newTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('providers', 'leads', 'unlocks', 'unlock_audit_log')
      ORDER BY table_name
    `);
    newTables.rows.forEach(t => console.log(`   ✅ ${t.table_name}`));
    
    console.log('\n🚀 Your Gold Touch Lead system is ready!');
    console.log('   Test with provider_id values: 1, 2, or 3');
    
    client.release();
    
  } catch (error) {
    console.error('❌ Error setting up database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  setupYourDatabase()
    .then(() => {
      console.log('\n✨ Database setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = setupYourDatabase;
