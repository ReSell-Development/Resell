/**
 * Refresh-token persistence service.
 *
 * Stateless access JWTs stay verification-only, but every issued REFRESH
 * token gets a DB row (SHA-256 hash, user, expiry, revoked flag) so:
 *   - logout / rotation-reuse keeps working across backend restarts
 *     (the in-memory JWT blacklist does not survive a reboot);
 *   - rotation is enforced single-use: presenting an already-rotated token
 *     is rejected instead of minting a fresh pair (replay protection).
 *
 * Only hashes are stored — a DB read never yields a usable token.
 */

const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');

/**
 * Persist a newly issued refresh token. `expiresAt` must mirror the JWT's
 * own exp (callers pass decoded.exp * 1000) so the row and the token agree.
 */
const persistRefreshToken = async ({ token, userId, expiresAt }) => {
  const record = await RefreshToken.create({
    tokenHash: hashToken(token),
    user: userId,
    expiresAt: new Date(expiresAt),
  });
  return record;
};

/**
 * Look up the DB record for a presented refresh token. Returns the record
 * (revoked or not — callers decide) or null when unknown.
 */
const findRefreshTokenRecord = async (token) => {
  if (!token) return null;
  return RefreshToken.findOne({ tokenHash: hashToken(token) });
};

/** True when the record exists, is not revoked, and has not expired. */
const isRefreshTokenRecordUsable = (record) => {
  if (!record || record.revoked) return false;
  if (!record.expiresAt || record.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

/**
 * Single-use rotation: revoke the presented token (linking its successor)
 * and persist the replacement. Not atomic across the two writes, but the
 * window is a single request and a concurrent reuse of the old token resolves
 * to revoked either way — fail-closed on replay.
 */
const rotateRefreshToken = async ({ oldToken, newToken, userId, newExpiresAt }) => {
  const oldHash = hashToken(oldToken);
  const newHash = hashToken(newToken);
  await RefreshToken.updateOne(
    { tokenHash: oldHash },
    { $set: { revoked: true, revokedAt: new Date(), replacedBy: newHash } }
  );
  return RefreshToken.create({
    tokenHash: newHash,
    user: userId,
    expiresAt: new Date(newExpiresAt),
  });
};

/** Revoke the record for a presented token (logout). Missing row = no-op. */
const revokeRefreshToken = async (token) => {
  if (!token) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(token) },
    { $set: { revoked: true, revokedAt: new Date() } }
  );
};

module.exports = {
  hashToken,
  persistRefreshToken,
  findRefreshTokenRecord,
  isRefreshTokenRecordUsable,
  rotateRefreshToken,
  revokeRefreshToken,
};
