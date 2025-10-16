-- Add slug field to providers table for unique URLs
ALTER TABLE providers ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;

-- Create index for slug lookups
CREATE INDEX IF NOT EXISTS idx_providers_slug ON providers(slug);

-- Generate slugs for existing providers
UPDATE providers SET slug = LOWER(REPLACE(name, ' ', '-')) || '-' || provider_id WHERE slug IS NULL;

-- Add constraint to ensure slug is always provided for new providers
ALTER TABLE providers ALTER COLUMN slug SET NOT NULL;
