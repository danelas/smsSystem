/**
 * Migration: Add first_lead_used flag to providers
 * Run this once after deployment
 */

const pool = require('../config/database');

async function up() {
  console.log('Running migration: Add first_lead_used column...');
  
  await pool.query(`
    ALTER TABLE providers 
    ADD COLUMN IF NOT EXISTS first_lead_used BOOLEAN DEFAULT FALSE
  `);
  
  await pool.query(`
    UPDATE providers 
    SET first_lead_used = FALSE 
    WHERE first_lead_used IS NULL
  `);
  
  console.log('✅ Migration complete: first_lead_used column added');
}

async function down() {
  console.log('Rolling back migration: Remove first_lead_used column...');
  
  await pool.query(`
    ALTER TABLE providers 
    DROP COLUMN IF EXISTS first_lead_used
  `);
  
  console.log('✅ Rollback complete');
}

module.exports = { up, down };

// Run if called directly
if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}
