const REQUIRED_VARS = [
  'MONGODB_URI',
  'JWT_SECRET',
];

const REQUIRED_IN_PRODUCTION = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CLIENT_URL',
];

// Minimum length for signing secrets before we consider them safe. Anything
// shorter is either a placeholder or brute-forceable.
const MIN_SECRET_LENGTH = 32;

const OPTIONAL_WITH_DEFAULTS = {
  PORT: '5000',
  NODE_ENV: 'development',
  JWT_ACCESS_EXPIRE: '15m',
  JWT_REFRESH_EXPIRE: '7d',
  REDIS_URL: 'redis://localhost:6379',
  ML_SERVICE_URL: 'http://localhost:8000',
  ML_BLEND_WEIGHT: '0.7',
  HASH_SIMILARITY_THRESHOLD: '12',
  // SCRUM-30 — graded duplicate decisions. `block`/`review` are pHash hamming
  // distances: at/below block a pair is an image copy (BLOCK), between block
  // and review it is a REVIEW, beyond review it is ALLOW.
  DUPLICATE_BLOCK_DISTANCE: '6',
  DUPLICATE_REVIEW_DISTANCE: '12',
  DUPLICATE_CROSS_BLOCK_DISTANCE: '8',
  DUPLICATE_CROSS_REVIEW_DISTANCE: '14',
  // The same break points on the continuous 0..1 scores the pipeline fuses.
  IMAGE_COPY_BLOCK_SCORE: '0.90',
  IMAGE_COPY_REVIEW_SCORE: '0.75',
  PHYSICAL_ITEM_BLOCK_SCORE: '0.97',
  PHYSICAL_ITEM_REVIEW_SCORE: '0.90',
  VISUAL_SIMILARITY_MEDIUM_THRESHOLD: '0.90',
  VISUAL_SIMILARITY_STRONG_THRESHOLD: '0.97',
  SAME_SELLER_SIM_THRESHOLD: '0.82',
  SAME_SELLER_WHOLE_SIM_THRESHOLD: '0.85',
  SAME_SELLER_CROP_COLOR_COSINE: '0.78',
  SAME_SELLER_COLOR_CORR: '0.85',
  DUPLICATE_SCAN_CAP: '500',
  VISUAL_SCAN_CAP: '200',
  OBJECT_DETECTION_MIN_SCORE: '0.5',
  OBJECT_DETECTION_IOU_THRESHOLD: '0.6',
  OBJECT_DETECTION_MAX_OBJECTS: '8',
  MAX_IMAGE_SIZE: '10485760',
};

const validateEnv = () => {
  // Support both MONGODB_URI and MONGO_URI interchangeably
  if (!process.env.MONGODB_URI && process.env.MONGO_URI) {
    process.env.MONGODB_URI = process.env.MONGO_URI;
  }

  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(`\n[FATAL CONFIG ERROR] Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('Please create or update your "backend/.env" file with these values.');
    console.error('Refer to "backend/.env.example" for the full list of required settings.\n');
    process.exit(1);
  }

  // ── JWT_SECRET stability ───────────────────────────────────────────
  // There is NO per-boot random fallback for the signing secret. Generating
  // one when the env var is missing would silently invalidate every access
  // AND refresh token on each restart (the frontend keeps its cookies but
  // every request/reject pair 401s) — i.e. all users logged out on every
  // `npm run dev` restart. Instead it is a hard requirement above: startup
  // aborts until a stable secret is configured, and the same value must be
  // used across boots.
  //
  // Access and refresh tokens are both signed with JWT_SECRET (there is no
  // separate refresh-token secret), so one stable secret is what keeps
  // refresh tokens verifiable after a restart.
  const jwtSecret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  const looksLikePlaceholder = /your[-_ ]?super[-_ ]?secret|change[-_ ]?me|changeme|example|placeholder|your_jwt_secret/i.test(
    jwtSecret
  );

  if (isProduction && (jwtSecret.length < MIN_SECRET_LENGTH || looksLikePlaceholder)) {
    console.error('\n[FATAL CONFIG ERROR] JWT_SECRET is too weak for production.');
    console.error(
      `Use a random secret of at least ${MIN_SECRET_LENGTH} characters (e.g. "node -e \\"console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))\\""), `
    );
    console.error('not the placeholder from .env.example, and keep it stable across restarts —');
    console.error('changing it logs every user out.\n');
    process.exit(1);
  }

  if (jwtSecret.length < MIN_SECRET_LENGTH || looksLikePlaceholder) {
    console.warn('\n[WARNING] JWT_SECRET looks weak or is still the .env.example placeholder.');
    console.warn('  Any restart that changes it invalidates all access AND refresh tokens (users get logged out).');
    console.warn(`  Set a stable random value of at least ${MIN_SECRET_LENGTH} characters in backend/.env.\n`);
  }

  // Stripe is required in production, warns in development
  if (isProduction) {
    const missingProd = REQUIRED_IN_PRODUCTION.filter((v) => !process.env[v]);
    if (missingProd.length > 0) {
      console.error(`[Config] Missing required production variables: ${missingProd.join(', ')}`);
      console.error('[Config] Stripe is required for checkout in production.');
      process.exit(1);
    }
  } else {
    for (const v of REQUIRED_IN_PRODUCTION) {
      if (!process.env[v]) {
        console.warn(`[Config] ${v} not set — Stripe checkout is optional and unavailable locally`);
      }
    }
    if (!process.env.CLIENT_URL) {
      console.warn('[Config] CLIENT_URL not set — CORS will reject all cross-origin requests');
    }
  }

  for (const [key, defaultValue] of Object.entries(OPTIONAL_WITH_DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = defaultValue;
      console.log(`[Config] ${key} not set, using default: ${defaultValue}${key === 'REDIS_URL' ? ' (workers require Redis; queues remain disabled when it is unavailable)' : ''}`);
    }
  }

  console.log('[Config] Environment validated successfully');
};

module.exports = validateEnv;
