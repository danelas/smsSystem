const pool = require('../src/config/database');

async function addFirstLeadFlag() {
  try {
    console.log('Adding first_lead_used column to providers table...');
    
    await pool.query(`
      ALTER TABLE providers 
      ADD COLUMN IF NOT EXISTS first_lead_used BOOLEAN DEFAULT FALSE
    `);
    
    console.log('✅ Column added successfully');
    
    // Set all existing providers to FALSE (they all get the free lead benefit)
    const result = await pool.query(`
      UPDATE providers 
      SET first_lead_used = FALSE 
      WHERE first_lead_used IS NULL
    `);
    
    console.log(`✅ Updated ${result.rowCount} existing providers`);
    
    // Verify the change
    const verify = await pool.query(`
      SELECT COUNT(*) as total, 
             COUNT(*) FILTER (WHERE first_lead_used = FALSE) as eligible_for_free
      FROM providers
    `);
    
    console.log('📊 Provider stats:', verify.rows[0]);
    console.log('✅ Migration complete!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addFirstLeadFlag();
