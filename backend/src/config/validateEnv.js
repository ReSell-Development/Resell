const REQUIRED_VARS = [
  'MONGODB_URI',
  'JWT_SECRET',
];

const REQUIRED_IN_PRODUCTION = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CLIENT_URL',
];

const OPTIONAL_WITH_DEFAULTS = {
  PORT: '5000',
  NODE_ENV: 'development',
  JWT_EXPIRE: '7d',
  REDIS_URL: 'redis://localhost:6379',
};

const validateEnv = () => {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(`[Config] Missing required environment variables: ${missing.join(', ')}`);
    console.error('[Config] Set these in your .env file or environment. See .env.example for reference.');
    process.exit(1);
  }

  // Stripe is required in production, warns in development
  if (process.env.NODE_ENV === 'production') {
    const missingProd = REQUIRED_IN_PRODUCTION.filter((v) => !process.env[v]);
    if (missingProd.length > 0) {
      console.error(`[Config] Missing required production variables: ${missingProd.join(', ')}`);
      console.error('[Config] Stripe is required for checkout in production.');
      process.exit(1);
    }
  } else {
    for (const v of REQUIRED_IN_PRODUCTION) {
      if (!process.env[v]) {
        console.warn(`[Config] ${v} not set — checkout will be unavailable in development`);
      }
    }
    if (!process.env.CLIENT_URL) {
      console.warn('[Config] CLIENT_URL not set — CORS will reject all cross-origin requests');
    }
  }

  for (const [key, defaultValue] of Object.entries(OPTIONAL_WITH_DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = defaultValue;
      console.log(`[Config] ${key} not set, using default: ${defaultValue}`);
    }
  }

  console.log('[Config] Environment validated successfully');
};

module.exports = validateEnv;
