const express = require('express');
const router = express.Router();

/**
 * Comprehensive Stripe and Crypto Diagnostics Endpoint
 * Access at: /stripe-diagnostics
 */
router.get('/', (req, res) => {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      server_info: {
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        node_env: process.env.NODE_ENV
      },
      crypto_module: {},
      stripe_info: {},
      environment: {},
      recommendations: []
    };

    // Test 1: Check if crypto module is available
    try {
      const crypto = require('crypto');
      diagnostics.crypto_module = {
        available: true,
        type: typeof crypto,
        methods: {
          createHmac: typeof crypto.createHmac,
          createHash: typeof crypto.createHash,
          randomBytes: typeof crypto.randomBytes
        },
        test_hmac: null
      };

      // Test crypto functionality
      try {
        const testHmac = crypto.createHmac('sha256', 'test-secret')
          .update('test-data')
          .digest('hex');
        diagnostics.crypto_module.test_hmac = {
          success: true,
          hash: testHmac.substring(0, 16) + '...'
        };
      } catch (hmacError) {
        diagnostics.crypto_module.test_hmac = {
          success: false,
          error: hmacError.message
        };
      }
    } catch (cryptoError) {
      diagnostics.crypto_module = {
        available: false,
        error: cryptoError.message
      };
      diagnostics.recommendations.push('❌ CRITICAL: crypto module not available - this will cause Stripe webhook failures');
    }

    // Test 2: Check global.crypto
    diagnostics.crypto_module.global_crypto = {
      available: typeof global.crypto !== 'undefined',
      type: typeof global.crypto
    };

    // Test 3: Check Stripe module
    try {
      const stripe = require('stripe');
      
      // Try to get version safely
      let stripeVersion = 'unknown';
      try {
        const stripePkg = require('stripe/package.json');
        stripeVersion = stripePkg.version;
      } catch (versionError) {
        // If package.json can't be read due to exports, that's okay
        stripeVersion = 'installed (version check blocked by exports)';
      }
      
      diagnostics.stripe_info = {
        module_loaded: true,
        version: stripeVersion,
        type: typeof stripe,
        secret_key_configured: !!process.env.STRIPE_SECRET_KEY,
        webhook_secret_configured: !!process.env.STRIPE_WEBHOOK_SECRET,
        secret_key_prefix: process.env.STRIPE_SECRET_KEY ? 
          process.env.STRIPE_SECRET_KEY.substring(0, 7) + '...' : 'NOT SET',
        webhook_secret_prefix: process.env.STRIPE_WEBHOOK_SECRET ? 
          process.env.STRIPE_WEBHOOK_SECRET.substring(0, 7) + '...' : 'NOT SET'
      };

      // Test Stripe initialization
      if (process.env.STRIPE_SECRET_KEY) {
        try {
          const stripeInstance = stripe(process.env.STRIPE_SECRET_KEY);
          diagnostics.stripe_info.initialization = {
            success: true,
            webhooks_available: typeof stripeInstance.webhooks !== 'undefined',
            constructEvent_available: typeof stripeInstance.webhooks?.constructEvent === 'function'
          };
        } catch (initError) {
          diagnostics.stripe_info.initialization = {
            success: false,
            error: initError.message
          };
        }
      }
    } catch (stripeError) {
      diagnostics.stripe_info = {
        module_loaded: false,
        error: stripeError.message
      };
      diagnostics.recommendations.push('❌ Stripe module not loaded properly');
    }

    // Test 4: Environment variables
    diagnostics.environment = {
      NODE_ENV: process.env.NODE_ENV || 'not set',
      PORT: process.env.PORT || 'not set',
      has_database_url: !!process.env.DATABASE_URL,
      has_stripe_keys: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
    };

    // Generate recommendations
    if (!diagnostics.crypto_module.available) {
      diagnostics.recommendations.push('🔧 Install or enable crypto module in your Node.js environment');
      diagnostics.recommendations.push('🔧 Ensure Node.js version is >= 18.0.0');
    }

    if (diagnostics.crypto_module.available && !diagnostics.crypto_module.test_hmac?.success) {
      diagnostics.recommendations.push('⚠️ crypto module exists but HMAC test failed');
    }

    if (!diagnostics.stripe_info.secret_key_configured) {
      diagnostics.recommendations.push('⚠️ STRIPE_SECRET_KEY not configured');
    }

    if (!diagnostics.stripe_info.webhook_secret_configured) {
      diagnostics.recommendations.push('⚠️ STRIPE_WEBHOOK_SECRET not configured');
    }

    if (diagnostics.stripe_info.webhook_secret_configured && 
        !diagnostics.stripe_info.webhook_secret_prefix?.startsWith('whsec_')) {
      diagnostics.recommendations.push('⚠️ STRIPE_WEBHOOK_SECRET should start with "whsec_"');
    }

    if (diagnostics.crypto_module.available && 
        diagnostics.stripe_info.module_loaded && 
        diagnostics.stripe_info.secret_key_configured && 
        diagnostics.stripe_info.webhook_secret_configured) {
      diagnostics.recommendations.push('✅ All checks passed - Stripe webhooks should work');
    }

    // Overall status
    diagnostics.status = diagnostics.recommendations.some(r => r.includes('❌')) ? 'ERROR' : 
                        diagnostics.recommendations.some(r => r.includes('⚠️')) ? 'WARNING' : 
                        'OK';

    res.json({
      success: true,
      status: diagnostics.status,
      diagnostics: diagnostics
    });

  } catch (error) {
    console.error('Diagnostics endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

/**
 * Test webhook signature verification with dummy data
 */
router.post('/test-webhook-signature', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const crypto = require('crypto');
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    const result = {
      timestamp: new Date().toISOString(),
      tests: []
    };

    // Test 1: Crypto HMAC
    try {
      const testHmac = crypto.createHmac('sha256', 'test-secret')
        .update('test-payload')
        .digest('hex');
      result.tests.push({
        name: 'Crypto HMAC Test',
        status: 'PASS',
        result: testHmac.substring(0, 16) + '...'
      });
    } catch (error) {
      result.tests.push({
        name: 'Crypto HMAC Test',
        status: 'FAIL',
        error: error.message
      });
    }

    // Test 2: Stripe webhook signature generation
    try {
      const payload = JSON.stringify({ test: true });
      const secret = 'whsec_test_secret';
      
      // Generate a test signature
      const timestamp = Math.floor(Date.now() / 1000);
      const signedPayload = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');
      
      const header = `t=${timestamp},v1=${signature}`;
      
      result.tests.push({
        name: 'Stripe Signature Generation',
        status: 'PASS',
        signature_header: header.substring(0, 40) + '...'
      });

      // Test 3: Try to construct event (will fail with test data, but we want to see the error)
      try {
        stripe.webhooks.constructEvent(payload, header, secret);
        result.tests.push({
          name: 'Stripe constructEvent',
          status: 'PASS'
        });
      } catch (constructError) {
        // This is expected to fail with test data, but the error message tells us if crypto is the issue
        const isCryptoError = constructError.message.includes('crypto');
        result.tests.push({
          name: 'Stripe constructEvent',
          status: isCryptoError ? 'FAIL' : 'EXPECTED_FAIL',
          error: constructError.message,
          note: isCryptoError ? 'CRYPTO MODULE ISSUE' : 'Test signature expected to fail'
        });
      }
    } catch (error) {
      result.tests.push({
        name: 'Stripe Signature Test',
        status: 'FAIL',
        error: error.message
      });
    }

    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;
