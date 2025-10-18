const pool = require('../config/database');

async function addMissingLeadColumns() {
  try {
    console.log('Adding missing columns to leads table...');
    
    // Add session_length column if it doesn't exist
    await pool.query(`
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS session_length VARCHAR(50)
    `);
    
    // Add location_type column if it doesn't exist
    await pool.query(`
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS location_type VARCHAR(100)
    `);
    
    console.log('Successfully added missing columns to leads table');
    
  } catch (error) {
    console.error('Error adding missing columns:', error);
    throw error;
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  addMissingLeadColumns()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addMissingLeadColumns;
