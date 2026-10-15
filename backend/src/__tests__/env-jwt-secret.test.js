/**
 * validateEnv — JWT_SECRET stability regression tests.
 *
 * The reported bug ("sessions are lost every time the backend restarts") had
 * a secret-stability component: if the signing secret is regenerated per boot,
 * every previously issued access AND refresh token becomes unverifiable while
 * the browser keeps its cookies — a silent logout for every user on each
 * restart. These tests lock in the rule:
 *
 *   - JWT_SECRET is REQUIRED (missing => startup aborts, no random fallback)
 *   - a weak/placeholder secret warns loudly in development and aborts in
 *     production (changing it later also logs everyone out)
 *   - no code path generates a secret at boot
 */

const STRONG_SECRET = 'x'.repeat(48);

// Load a fresh copy of the validator (it reads process.env at call time).
const loadValidateEnv = () => {
  let validateEnv;
  jest.isolateModules(() => {
    validateEnv = require('../config/validateEnv');
  });
  return validateEnv;
};

describe('validateEnv — JWT_SECRET stability', () => {
  const originalEnv = process.env;
  let exitSpy;
  let warnSpy;
  let errorSpy;
  let logSpy;

  beforeEach(() => {
    // Never actually kill the jest worker: record the code and keep going.
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`__exit__${code}`);
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  const withEnv = (overrides = {}) => {
    const env = {
      ...originalEnv,
      MONGODB_URI: 'mongodb://localhost:27017/resell-env-test',
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      CLIENT_URL: 'http://localhost:3000',
      NODE_ENV: 'development',
      JWT_SECRET: STRONG_SECRET,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    process.env = env;
  };

  const ranToCompletion = () => logSpy.mock.calls.some(
    (call) => String(call[0]).includes('Environment validated successfully')
  );

  it('aborts startup when JWT_SECRET is missing instead of generating one', () => {
    withEnv({ JWT_SECRET: undefined });
    const validateEnv = loadValidateEnv();

    expect(() => validateEnv()).toThrow('__exit__1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('JWT_SECRET');
    // No random fallback was ever created for later verification.
    expect(process.env.JWT_SECRET).toBeUndefined();
  });

  it('accepts a stable strong secret without warnings', () => {
    withEnv({ JWT_SECRET: STRONG_SECRET });
    const validateEnv = loadValidateEnv();

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.env.JWT_SECRET).toBe(STRONG_SECRET);
    expect(ranToCompletion()).toBe(true);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('JWT_SECRET');
  });

  it('warns loudly (but still boots) on a weak secret in development', () => {
    withEnv({ JWT_SECRET: 'short-secret' });
    const validateEnv = loadValidateEnv();

    expect(() => validateEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    const warnings = warnSpy.mock.calls.flat().join(' ');
    expect(warnings).toContain('JWT_SECRET');
    expect(warnings).toMatch(/invalidat/i);
  });

  it('warns when the .env.example placeholder secret is still in use', () => {
    withEnv({ JWT_SECRET: 'your-super-secret-jwt-key-change-in-production' });
    const validateEnv = loadValidateEnv();

    expect(() => validateEnv()).not.toThrow();
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('JWT_SECRET');
  });

  it('refuses to boot in production with a weak/placeholder secret', () => {
    withEnv({ NODE_ENV: 'production', JWT_SECRET: 'your-super-secret-jwt-key-change-in-production' });
    const validateEnv = loadValidateEnv();

    expect(() => validateEnv()).toThrow('__exit__1');
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('JWT_SECRET');
  });

  it('signs access AND refresh tokens with JWT_SECRET, never a per-boot fallback', () => {
    // Access and refresh tokens share JWT_SECRET — there is intentionally no
    // separate (and therefore potentially per-boot) refresh secret, and no
    // `JWT_SECRET || <random>` fallback that would silently invalidate every
    // previously issued token on restart.
    const jwt = require('../utils/jwt');
    for (const fn of [jwt.generateToken, jwt.generateRefreshToken, jwt.verifyToken]) {
      const source = fn.toString();
      expect(source).toContain('JWT_SECRET');
      // A fallback would silently mint tokens signed by a per-boot secret.
      expect(source).not.toMatch(/JWT_SECRET\s*\|\|/);
      expect(source).not.toMatch(/crypto\.randomBytes/);
    }
  });
});
