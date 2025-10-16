const { Pool } = require('pg');

async function fixExistingDatabase() {
  const pool = new Pool({
    connectionString: 'postgresql://providers_1foz_user:F397IAbZan3w01duRyVv8xKZWqDPFg7W@dpg-d31kvs6mcj7s738qhkb0-a.virginia-postgres.render.com/providers_1foz',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Connecting to your database...');
    const client = await pool.connect();
    console.log('✅ Connected successfully');
    
    // Check existing providers table structure
    console.log('📋 Checking existing providers table...');
    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'providers'
      ORDER BY ordinal_position;
    `);
    
    console.log('Current providers table structure:');
    tableInfo.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} (${col.is_nullable})`);
    });
    
    // Check existing data
    const existingData = await client.query('SELECT * FROM providers LIMIT 5');
    console.log('\nExisting providers data:');
    console.log(existingData.rows);
    
    // Add provider_id column if it doesn't exist
    const hasProviderId = tableInfo.rows.some(col => col.column_name === 'provider_id');
    
    if (!hasProviderId) {
      console.log('🔄 Adding provider_id column...');
      await client.query('ALTER TABLE providers ADD COLUMN provider_id SERIAL PRIMARY KEY');
      console.log('✅ Added provider_id column');
    } else {
      console.log('✅ provider_id column already exists');
    }
    
    // Add missing columns for Gold Touch Lead system
    const requiredColumns = [
      { name: 'sms_opted_out', type: 'BOOLEAN DEFAULT false' },
      { name: 'is_verified', type: 'BOOLEAN DEFAULT true' },
      { name: 'service_areas', type: 'TEXT[]' },
      { name: 'created_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
      { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
    ];
    
    for (const col of requiredColumns) {
      const hasColumn = tableInfo.rows.some(existing => existing.column_name === col.name);
      if (!hasColumn) {
        console.log(`🔄 Adding ${col.name} column...`);
        await client.query(`ALTER TABLE providers ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✅ Added ${col.name} column`);
      }
    }
    
    // Now create the other tables
    console.log('🔄 Creating leads table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        city VARCHAR(100) NOT NULL,
        service_type VARCHAR(100) NOT NULL,
        preferred_time_window TIMESTAMP,
        budget_range VARCHAR(100),
        notes_snippet TEXT,
        client_name VARCHAR(255) NOT NULL,
        client_phone VARCHAR(20) NOT NULL,
        client_email VARCHAR(255),
        exact_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
        is_closed BOOLEAN DEFAULT false
      );
    `);
    console.log('✅ Leads table created');
    
    console.log('🔄 Creating unlocks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS unlocks (
        lead_id UUID NOT NULL REFERENCES leads(lead_id),
        provider_id INTEGER NOT NULL REFERENCES providers(provider_id),
        status VARCHAR(50) NOT NULL DEFAULT 'NEW_LEAD',
        idempotency_key VARCHAR(255) UNIQUE,
        checkout_session_id VARCHAR(255),
        payment_link_url TEXT,
        last_sent_at TIMESTAMP,
        unlocked_at TIMESTAMP,
        ttl_expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
        teaser_sent_at TIMESTAMP,
        y_received_at TIMESTAMP,
        payment_link_sent_at TIMESTAMP,
        paid_at TIMESTAMP,
        revealed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (lead_id, provider_id)
      );
    `);
    console.log('✅ Unlocks table created');
    
    console.log('🔄 Creating audit log table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS unlock_audit_log (
        id SERIAL PRIMARY KEY,
        lead_id UUID REFERENCES leads(lead_id),
        provider_id INTEGER REFERENCES providers(provider_id),
        event_type VARCHAR(50) NOT NULL,
        checkout_session_id VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Audit log table created');
    
    // Update existing providers with default values
    console.log('🔄 Updating existing providers...');
    await client.query(`
      UPDATE providers 
      SET 
        sms_opted_out = COALESCE(sms_opted_out, false),
        is_verified = COALESCE(is_verified, true),
        service_areas = COALESCE(service_areas, ARRAY['Miami', 'Hollywood', 'Fort Lauderdale']),
        created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
        updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE sms_opted_out IS NULL OR is_verified IS NULL OR service_areas IS NULL;
    `);
    
    // Show final providers
    const finalProviders = await client.query('SELECT provider_id, name, phone, sms_opted_out FROM providers ORDER BY provider_id');
    console.log('\n🎉 Setup complete! Your providers:');
    finalProviders.rows.forEach(p => {
      console.log(`   Provider ${p.provider_id}: ${p.name} (${p.phone}) - SMS: ${p.sms_opted_out ? 'OPTED OUT' : 'ACTIVE'}`);
    });
    
    console.log('\n🚀 Your Gold Touch Lead system is ready!');
    console.log(`   Use provider_id values: ${finalProviders.rows.map(p => `provider${p.provider_id}`).join(', ')}`);
    
    client.release();
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  fixExistingDatabase()
    .then(() => {
      console.log('\n✨ Database setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = fixExistingDatabase;
