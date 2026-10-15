const mongoose = require('mongoose');

/**
 * Persisted refresh-token record (one row per issued refresh token).
 *
 * Why DB-backed instead of purely stateless JWTs: a stateless refresh token
 * cannot be revoked — logout, password change, or a rotation-reuse (replay)
 * must keep working across backend restarts, and the in-memory JWT blacklist
 * is wiped on every reboot. Only the SHA-256 hash is stored, never the token.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Mirrors the JWT's own exp (default 7d). A TTL index deletes the row
    // once it can no longer be presented, so the collection cannot grow
    // unboundedly. Revoked rows vanish the same way.
    // NOTE: no field-level `index: true` here — declaring the same key twice
    // (plain + TTL) makes MongoDB's index build fail with IndexOptionsConflict
    // (code 85) and can leave the plain, non-expiring variant behind, so the
    // TTL would never fire. The single TTL index below is the only index on
    // this field and serves lookups too.
    expiresAt: {
      type: Date,
      required: true,
    },
    revoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date, default: null },
    // Hash of the successor issued by rotation (audit trail for replay detection).
    replacedBy: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Auto-remove rows past their expiry (see expiresAt above).
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
