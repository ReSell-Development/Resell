/**
 * Token blacklist for logout invalidation.
 *
 * Since JWTs are stateless, a logged-out token remains valid until expiry.
 * This module maintains an in-memory set of revoked token JIDs (JWT IDs).
 * Tokens on the blacklist are rejected by the auth middleware.
 *
 * In production, replace with Redis-backed blacklist for multi-instance support.
 */

const blacklistedJIDs = new Set();

// Auto-cleanup: remove entries older than max token lifetime (7 days for refresh tokens)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly
const MAX_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const entry of blacklistedJIDs) {
      const [, expiry] = entry.split('|');
      if (parseInt(expiry, 10) < now) {
        blacklistedJIDs.delete(entry);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

const blacklistToken = (jti, expiresAt) => {
  blacklistedJIDs.add(`${jti}|${new Date(expiresAt).getTime()}`);
};

const isBlacklisted = (jti) => {
  for (const entry of blacklistedJIDs) {
    if (entry.startsWith(jti + '|')) return true;
  }
  return false;
};

module.exports = { blacklistToken, isBlacklisted };
