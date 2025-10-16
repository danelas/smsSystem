const { Pool } = require('pg');

async function addMissingTables() {
  const pool = new Pool({
    connectionString: 'postgresql://providers_1foz_user:F397IAbZan3w01duRyVv8xKZWqDPFg7W@dpg-d31kvs6mcj7s738qhkb0-a.virginia-postgres.render.com/providers_1foz',
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔄 Connecting to your database...');
    const client = await pool.connect();
    console.log('✅ Connected successfully');
    
    // Just create the leads table (using string provider IDs to match your existing system)
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
    
    // Create unlocks table with string provider_id to match your system
    console.log('🔄 Creating unlocks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS unlocks (
        lead_id UUID NOT NULL REFERENCES leads(lead_id),
        provider_id VARCHAR(20) NOT NULL,
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
    
    // Create audit log table
    console.log('🔄 Creating audit log table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS unlock_audit_log (
        id SERIAL PRIMARY KEY,
        lead_id UUID REFERENCES leads(lead_id),
        provider_id VARCHAR(20),
        event_type VARCHAR(50) NOT NULL,
        checkout_session_id VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Audit log table created');
    
    // Create indexes
    console.log('🔄 Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
      CREATE INDEX IF NOT EXISTS idx_leads_service_type ON leads(service_type);
      CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
      CREATE INDEX IF NOT EXISTS idx_leads_expires_at ON leads(expires_at);
      CREATE INDEX IF NOT EXISTS idx_unlocks_status ON unlocks(status);
      CREATE INDEX IF NOT EXISTS idx_unlocks_ttl ON unlocks(ttl_expires_at);
      CREATE INDEX IF NOT EXISTS idx_unlocks_provider ON unlocks(provider_id);
      CREATE INDEX IF NOT EXISTS idx_unlocks_checkout_session ON unlocks(checkout_session_id);
    `);
    console.log('✅ Indexes created');
    
    console.log('\n🎉 Setup complete!');
    console.log('🚀 Your Gold Touch Lead system is ready!');
    console.log('\n📋 You can now test with any of your existing providers:');
    console.log('   provider_id: "provider1", "provider2", "provider3", ... "provider23"');
    console.log('\n🔗 Webhook URL: https://smssystem.onrender.com/webhooks/fluentforms');
    
    client.release();
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  addMissingTables()
    .then(() => {
      console.log('\n✨ Database setup completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Setup failed:', error.message);
      process.exit(1);
    });
}

module.exports = addMissingTables;
