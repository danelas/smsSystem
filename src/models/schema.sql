-- Create providers table
CREATE TABLE IF NOT EXISTS providers (
    provider_id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    is_verified BOOLEAN DEFAULT false,
    sms_opted_out BOOLEAN DEFAULT false,
    service_areas TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create leads table
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

-- Create unlocks table (renamed from lead_provider_interactions)
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
    -- Audit trail fields
    teaser_sent_at TIMESTAMP,
    y_received_at TIMESTAMP,
    payment_link_sent_at TIMESTAMP,
    paid_at TIMESTAMP,
    revealed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lead_id, provider_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_service_type ON leads(service_type);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_expires_at ON leads(expires_at);
CREATE INDEX IF NOT EXISTS idx_unlocks_status ON unlocks(status);
CREATE INDEX IF NOT EXISTS idx_unlocks_ttl ON unlocks(ttl_expires_at);
CREATE INDEX IF NOT EXISTS idx_unlocks_provider ON unlocks(provider_id);
CREATE INDEX IF NOT EXISTS idx_unlocks_checkout_session ON unlocks(checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_providers_phone ON providers(phone);
CREATE INDEX IF NOT EXISTS idx_providers_opted_out ON providers(sms_opted_out);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_providers_updated_at 
    BEFORE UPDATE ON providers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_unlocks_updated_at 
    BEFORE UPDATE ON unlocks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create audit log table for tracking important events
CREATE TABLE IF NOT EXISTS unlock_audit_log (
    id SERIAL PRIMARY KEY,
    lead_id UUID REFERENCES leads(lead_id),
    provider_id INTEGER REFERENCES providers(provider_id),
    event_type VARCHAR(50) NOT NULL,
    checkout_session_id VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_provider ON unlock_audit_log(lead_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON unlock_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON unlock_audit_log(created_at);
