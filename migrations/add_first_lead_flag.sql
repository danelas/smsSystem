-- Add first_lead_used column to providers table
-- This tracks whether a provider has used their free first lead

ALTER TABLE providers 
ADD COLUMN IF NOT EXISTS first_lead_used BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN providers.first_lead_used IS 'Tracks if provider has used their one free lead welcome gift';

-- For existing providers, set to FALSE (they all get the free lead benefit)
UPDATE providers SET first_lead_used = FALSE WHERE first_lead_used IS NULL;
