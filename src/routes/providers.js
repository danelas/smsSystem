const express = require('express');
const router = express.Router();
const Provider = require('../models/Provider');

// Get all providers with their unique URLs (for homepage buttons)
router.get('/', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const providers = await Provider.getAllWithUrls(baseUrl);
    
    res.json({
      success: true,
      providers: providers,
      total: providers.length
    });
  } catch (error) {
    console.error('Error getting providers:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get providers' 
    });
  }
});

// Get specific provider by slug (for form page)
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Since slug column doesn't exist yet, try to find by generated slug
    const providers = await Provider.getAllWithUrls();
    const provider = providers.find(p => p.slug === slug);
    
    if (!provider) {
      return res.status(404).json({ 
        success: false,
        error: 'Provider not found' 
      });
    }

    // Don't expose sensitive info
    const publicProvider = {
      id: provider.id,
      name: provider.name,
      slug: provider.slug,
      phone: provider.phone
    };

    res.json({
      success: true,
      provider: publicProvider
    });
  } catch (error) {
    console.error('Error getting provider by slug:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get provider' 
    });
  }
});

// Form page route - serves the form with provider pre-selected
router.get('/:slug/form', async (req, res) => {
  try {
    const { slug } = req.params;
    const provider = await Provider.findBySlug(slug);
    
    if (!provider) {
      return res.status(404).json({ 
        success: false,
        error: 'Provider not found' 
      });
    }

    // Return HTML form or redirect to form with provider_id
    // This could serve an HTML page or return JSON for a SPA
    res.json({
      success: true,
      provider: {
        id: provider.id,
        name: provider.name,
        slug: provider.slug,
        phone: provider.phone
      },
      form_action: '/webhooks/fluentforms',
      message: `Fill out the form below to request service from ${provider.name}`
    });
  } catch (error) {
    console.error('Error loading provider form:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load form' 
    });
  }
});

// Setup/migration endpoint to generate slugs for existing providers
router.post('/setup/slugs', async (req, res) => {
  try {
    console.log('🔄 Generating slugs for existing providers...');
    
    const pool = require('../config/database');
    
    // First, run the migration to add the slug column
    const migrationSQL = `
      ALTER TABLE providers ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
      CREATE INDEX IF NOT EXISTS idx_providers_slug ON providers(slug);
    `;
    
    await pool.query(migrationSQL);
    console.log('✅ Slug column added');
    
    // Get all providers without slugs
    const providersResult = await pool.query(
      'SELECT id, name FROM providers WHERE slug IS NULL'
    );
    
    const updatedProviders = [];
    
    for (const provider of providersResult.rows) {
      const slug = Provider.generateSlug(provider.name, provider.id);
      
      try {
        const updated = await Provider.updateSlug(provider.id, slug);
        updatedProviders.push(updated);
        console.log(`✅ Generated slug for ${provider.name}: ${slug}`);
      } catch (error) {
        console.error(`❌ Failed to update slug for ${provider.name}:`, error);
      }
    }
    
    // Make slug NOT NULL after generating all slugs
    await pool.query('ALTER TABLE providers ALTER COLUMN slug SET NOT NULL');
    await pool.query('ALTER TABLE providers ADD CONSTRAINT providers_slug_unique UNIQUE (slug)');
    
    res.json({
      success: true,
      message: 'Slugs generated successfully',
      updated_providers: updatedProviders.length,
      providers: updatedProviders
    });
    
  } catch (error) {
    console.error('❌ Slug generation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Slug generation failed',
      details: error.message
    });
  }
});

module.exports = router;
