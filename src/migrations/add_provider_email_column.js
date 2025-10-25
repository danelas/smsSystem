const pool = require('../config/database');

async function addProviderEmailColumn() {
  try {
    console.log('Adding email column to providers table...');
    
    // Add email column if it doesn't exist
    await pool.query(`
      ALTER TABLE providers 
      ADD COLUMN IF NOT EXISTS email VARCHAR(255)
    `);
    
    console.log('Successfully added email column to providers table');
    
  } catch (error) {
    console.error('Error adding email column:', error);
    throw error;
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  addProviderEmailColumn()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addProviderEmailColumn;
