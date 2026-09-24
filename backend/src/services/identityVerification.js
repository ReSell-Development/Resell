/**
 * Identity Verification Service
 *
 * Verifies physical product ownership during listing creation.
 * Extends (does not replace) existing fraud detection: pHash/image
 * similarity, MobileNet, seller trust, etc.
 *
 * Key semantics:
 *   - New identifier            -> registered
 *   - Existing + same owner     -> legitimate relisting
 *   - Existing + verified Sale/ownership transfer -> legitimate resale
 *   - Existing + no transfer    -> strong OWNERSHIP_MISMATCH signal
 *   - Same identifier on multiple ACTIVE listings -> duplicate-physical-product signal
 *   - reported_stolen / flagged -> blocked or held for moderation
 *
 * Raw identifiers are hashed; only safe fields are returned to clients.
 */

const mongoose = require('mongoose');
const ProductIdentity = require('../models/ProductIdentity');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const AppError = require('../utils/AppError');
const { hashIdentifier, issueVerificationCode, safeCodeEqual, createProvenanceEvent } = require('./provenance');

// Signals understood by the fraud engine (fraudDetection.js)
const SIGNALS = {
  PRODUCT_IDENTIFIER_REUSED: 'PRODUCT_IDENTIFIER_REUSED',
  OWNERSHIP_MISMATCH: 'OWNERSHIP_MISMATCH',
  NO_VERIFIED_TRANSFER: 'NO_VERIFIED_TRANSFER',
  MULTIPLE_ACTIVE_LISTINGS: 'MULTIPLE_ACTIVE_LISTINGS',
  PROVENANCE_INTEGRITY_FAILURE: 'PROVENANCE_INTEGRITY_FAILURE',
  REPORTED_STOLEN_PRODUCT: 'REPORTED_STOLEN_PRODUCT',
  POSSESSION_VERIFICATION_FAILED: 'POSSESSION_VERIFICATION_FAILED',
};

// Possession statuses (UNVERIFIED never counts as fraud on its own)
const POSSESSION_STATUSES = {
  VERIFIED: 'verified',
  FAILED: 'failed',
  UNVERIFIED: 'unverified',
};

// Max wrong-code submissions before the code is locked
const MAX_POSSESSION_ATTEMPTS = 5;

// Sale statuses that count as a verified ownership transfer
const VERIFIED_SALE_STATUSES = ['paid', 'shipped', 'delivered', 'completed'];

/**
 * Check whether any other ACTIVE listing shares this identity.
 */
const countOtherActiveListings = async (identityId, excludeProductId) => {
  return Product.countDocuments({
    productIdentity: identityId,
    status: 'active',
    ...(excludeProductId ? { _id: { $ne: excludeProductId } } : {}),
  });
};

/**
 * Whether the seller has a verified completed sale / ownership
 * transfer chain for the given identity's original product.
 */
const hasVerifiedTransfer = async (identity, sellerId) => {
  const sellerKey = sellerId.toString();

  // Platform-mediated sale of the registered product to this seller
  const sale = await Sale.findOne({
    product: identity.productId,
    buyer: sellerId,
    status: { $in: VERIFIED_SALE_STATUSES },
    paymentStatus: 'paid',
  })
    .select('_id')
    .lean();
  if (sale) return true;

  // Off-platform transfer recorded in the provenance chain
  const ProvenanceEvent = require('../models/ProvenanceEvent');
  const transferEvent = await ProvenanceEvent.findOne({
    productIdentityId: identity._id,
    eventType: 'ownership_transferred',
    ownerId: sellerId,
  })
    .select('_id')
    .lean();
  return !!transferEvent;
};

/**
 * Verify ownership for a listing being created.
 *
 * @param {Object} params
 * @param {string} params.rawIdentifier  Raw serial/IMEI/VIN from the seller
 * @param {string} params.identifierType imei | serial | vin
 * @param {string} params.sellerId       Listing owner
 * @param {string} [params.productId]    Existing product on edit (optional)
 * @param {string} [params.proofImageUrl] Proof-of-possession photo (optional)
 * @returns {Object} { outcome, identity, signals, warnings }
 */
const verifyOwnershipForListing = async ({
  rawIdentifier,
  identifierType,
  sellerId,
  productId,
  proofImageUrl,
}) => {
  const identifierHash = hashIdentifier(rawIdentifier, identifierType);
  const sellerKey = sellerId.toString();
  const signals = [];
  const warnings = [];

  let identity = await ProductIdentity.findOne({ identifierType, identifierHash });

  // A. New identifier -> register + REGISTERED event
  // (productId may be null when verification runs before the listing is
  // created; callers link the identity to the product after creation)
  if (!identity) {
    const { code, codeExpiresAt } = issueVerificationCode();
    identity = await ProductIdentity.create({
      productId: productId || new mongoose.Types.ObjectId(),
      identifierType,
      identifierHash,
      currentOwnerId: sellerId,
      status: 'active',
      verification: {
        proofPhotoUrl: proofImageUrl || '',
        verificationCode: code,
        codeExpiresAt,
        method: 'none',
        possessionStatus: POSSESSION_STATUSES.UNVERIFIED,
        verifiedAt: null,
        attempts: 0,
      },
    });
    await createProvenanceEvent({
      productIdentityId: identity._id,
      eventType: 'registered',
      ownerId: sellerId,
      listingId: productId,
    });
    return { outcome: 'registered', identity, signals, warnings };
  }

  // E. Stolen -> block
  if (identity.status === 'reported_stolen') {
    signals.push(SIGNALS.REPORTED_STOLEN_PRODUCT);
    return { outcome: 'reported_stolen', identity, signals, warnings };
  }

  // E. Flagged -> hold for moderation
  if (identity.status === 'flagged') {
    signals.push(SIGNALS.PROVENANCE_INTEGRITY_FAILURE);
    return { outcome: 'flagged', identity, signals, warnings };
  }

  // D. Same identifier on multiple ACTIVE listings (checked for any owner)
  const otherActive = await countOtherActiveListings(identity._id, productId);
  if (otherActive > 0) {
    signals.push(SIGNALS.PRODUCT_IDENTIFIER_REUSED, SIGNALS.MULTIPLE_ACTIVE_LISTINGS);
    warnings.push(
      'This serial/IMEI is already listed in another active listing. The physical product cannot be for sale twice.'
    );
  } else if (
    identity.productId &&
    identity.productId.toString() !== (productId || '').toString()
  ) {
    // Identifier reused on other (inactive) listings — informational signal
    signals.push(SIGNALS.PRODUCT_IDENTIFIER_REUSED);
  }

  // B. Existing identifier + same owner -> legitimate relisting
  if (identity.currentOwnerId.toString() === sellerKey) {
    // A sold product being relisted by its owner is active again
    if (identity.status === 'sold') {
      identity.status = 'active';
    }
    // Keep identity linked to the original registration, but if the original
    // product is gone, link the relisting.
    if (!identity.productId) {
      identity.productId = productId;
    }
    // Issue a fresh short-lived possession-verification code for the new
    // listing, preserving any completed verification
    const v = identity.verification || {};
    const { code, codeExpiresAt } = issueVerificationCode();
    identity.verification = {
      proofPhotoUrl: v.proofPhotoUrl || proofImageUrl || '',
      verificationCode: code,
      codeExpiresAt,
      method: v.method || 'none',
      possessionStatus: v.possessionStatus || POSSESSION_STATUSES.UNVERIFIED,
      verifiedAt: v.verifiedAt || null,
      attempts: v.attempts || 0,
    };
    await identity.save();
    return { outcome: 'relist', identity, signals, warnings };
  }

  // C. Existing identifier + different owner -> verify completed Sale/transfer
  const verified = await hasVerifiedTransfer(identity, sellerId);
  if (verified) {
    // Legitimate resale: identifier reuse is expected, not suspicious
    // ("same identifier + legitimate ownership transfer = normal resale").
    // Keep MULTIPLE_ACTIVE_LISTINGS if present — a genuine conflict.
    const idx = signals.indexOf(SIGNALS.PRODUCT_IDENTIFIER_REUSED);
    if (idx !== -1) signals.splice(idx, 1);
    identity.currentOwnerId = sellerId;
    identity.status = 'active';
    // Issue a fresh short-lived code for the new owner; their possession
    // is unverified until they submit the photo + code
    const v = identity.verification || {};
    const { code, codeExpiresAt } = issueVerificationCode();
    identity.verification = {
      proofPhotoUrl: proofImageUrl || v.proofPhotoUrl || '',
      verificationCode: code,
      codeExpiresAt,
      method: 'none',
      possessionStatus: POSSESSION_STATUSES.UNVERIFIED,
      verifiedAt: null,
      attempts: 0,
    };
    await identity.save();
    await createProvenanceEvent({
      productIdentityId: identity._id,
      eventType: 'ownership_transferred',
      ownerId: sellerId,
      listingId: productId,
    });
    return { outcome: 'transferred', identity, signals, warnings };
  }

  // No valid transfer -> strong ownership mismatch signal
  signals.push(SIGNALS.OWNERSHIP_MISMATCH, SIGNALS.NO_VERIFIED_TRANSFER);
  warnings.push(
    'Ownership of this serial/IMEI is registered to a different seller and no verified transfer was found. Your listing will be reviewed with elevated scrutiny.'
  );
  return { outcome: 'mismatch', identity, signals, warnings };
};

/**
 * Proof-of-possession verification (supporting signal, not proof of
 * ownership). The seller uploads a photo of the physical product beside
 * the short-lived code and submits the code — no OCR involved.
 *
 * Outcomes:
 *   - verified: correct code + photo, within the TTL window
 *   - failed:   wrong code (recorded; weak fraud signal after MAX attempts)
 *   - expired / locked: rejected without marking failed
 *
 * Missing verification (UNVERIFIED) is never treated as fraud.
 */
const verifyPossession = async ({ productId, sellerId, code, proofImageUrl }) => {
  const identity = await ProductIdentity.findOne({ productId });
  if (!identity) {
    throw new AppError('No product identity registered for this listing', 404, 'IDENTITY_NOT_FOUND');
  }
  if (identity.currentOwnerId.toString() !== sellerId.toString()) {
    throw new AppError('Only the current owner can verify possession', 403, 'FORBIDDEN');
  }

  const v = identity.verification || {};
  if (v.possessionStatus === POSSESSION_STATUSES.VERIFIED) {
    return { possessionStatus: POSSESSION_STATUSES.VERIFIED, alreadyVerified: true, verifiedAt: v.verifiedAt };
  }

  if (!proofImageUrl) {
    throw new AppError('A proof photo showing the product beside the verification code is required', 400, 'PROOF_PHOTO_REQUIRED');
  }
  if (!code) {
    throw new AppError('Verification code is required', 400, 'VERIFICATION_CODE_REQUIRED');
  }

  const now = new Date();
  if (!v.verificationCode || !v.codeExpiresAt || new Date(v.codeExpiresAt) < now) {
    // Code expired: issue a fresh one (visible to the owner only) so the
    // seller can retry; this attempt does not count as a failure
    const fresh = issueVerificationCode();
    identity.verification = { ...v, verificationCode: fresh.code, codeExpiresAt: fresh.codeExpiresAt };
    await identity.save();
    throw new AppError('Verification code has expired. A new code has been issued — check your listing identity status and try again.', 400, 'VERIFICATION_CODE_EXPIRED');
  }

  if ((v.attempts || 0) >= MAX_POSSESSION_ATTEMPTS) {
    throw new AppError('Too many failed attempts. Contact support to verify possession.', 429, 'VERIFICATION_ATTEMPTS_EXCEEDED');
  }

  if (safeCodeEqual(code, v.verificationCode)) {
    identity.verification = {
      proofPhotoUrl: proofImageUrl,
      verificationCode: v.verificationCode,
      codeExpiresAt: v.codeExpiresAt,
      method: 'photo_code',
      possessionStatus: POSSESSION_STATUSES.VERIFIED,
      verifiedAt: now,
      attempts: v.attempts || 0,
    };
    await identity.save();
    await createProvenanceEvent({
      productIdentityId: identity._id,
      eventType: 'possession_verified',
      ownerId: sellerId,
      listingId: productId,
    });
    return { possessionStatus: POSSESSION_STATUSES.VERIFIED, verifiedAt: now };
  }

  // Wrong code — supporting fraud signal, never blocking on its own
  identity.verification = {
    ...v,
    proofPhotoUrl: v.proofPhotoUrl || proofImageUrl,
    possessionStatus: POSSESSION_STATUSES.FAILED,
    attempts: (v.attempts || 0) + 1,
  };
  await identity.save();
  return {
    possessionStatus: POSSESSION_STATUSES.FAILED,
    remainingAttempts: Math.max(0, MAX_POSSESSION_ATTEMPTS - identity.verification.attempts),
  };
};

/**
 * Set an identity's registry status (reported_stolen / flagged / active).
 * Intended for authorized admin/moderator use only — controllers must
 * enforce authorization. Creates a 'reported' provenance event and
 * never touches the raw identifier (only the hash exists).
 *
 * @param {Object} params
 * @param {string} params.identityId  ProductIdentity _id
 * @param {string} params.status      active | flagged | reported_stolen
 * @param {string} [params.moderatorId] Acting admin/moderator
 * @param {string} [params.reportId]   Existing Report that triggered this
 */
const setIdentityStatus = async ({ identityId, status, moderatorId, reportId }) => {
  if (!['active', 'flagged', 'reported_stolen'].includes(status)) {
    throw new AppError('Invalid identity status', 400, 'IDENTITY_STATUS_INVALID');
  }
  const identity = await ProductIdentity.findById(identityId);
  if (!identity) {
    throw new AppError('Product identity not found', 404, 'IDENTITY_NOT_FOUND');
  }

  identity.status = status;
  await identity.save();

  // Audit trail in the hash-chained provenance history.
  // The report reference rides in transactionId (server-side only).
  await createProvenanceEvent({
    productIdentityId: identity._id,
    eventType: 'reported',
    ownerId: moderatorId || identity.currentOwnerId,
    listingId: identity.productId,
    transactionId: reportId ? `report:${reportId}` : null,
  });

  return identity;
};

/**
 * Record a sale/ownership transfer provenance event for a product
 * with an identity. Best-effort: never throws to callers.
 *
 * eventType: 'sold' (payment confirmed) | 'ownership_transferred' (buyer owns it)
 */
const recordSaleProvenance = async ({
  productId,
  sellerId,
  buyerId,
  transactionId,
  eventType,
}) => {
  try {
    if (!productId) return;
    const identity = await ProductIdentity.findOne({ productId });
    if (!identity) return;

    await createProvenanceEvent({
      productIdentityId: identity._id,
      eventType,
      ownerId: buyerId || sellerId,
      listingId: productId,
      transactionId: transactionId || null,
    });

    if (eventType === 'sold') {
      identity.status = 'sold';
    }
    if (eventType === 'ownership_transferred' && buyerId) {
      identity.status = 'active';
      identity.currentOwnerId = buyerId;
    }
    await identity.save();
  } catch (err) {
    console.error('[IdentityVerification] recordSaleProvenance error:', err.message);
  }
};

module.exports = {
  SIGNALS,
  POSSESSION_STATUSES,
  MAX_POSSESSION_ATTEMPTS,
  verifyOwnershipForListing,
  verifyPossession,
  setIdentityStatus,
  recordSaleProvenance,
  hasVerifiedTransfer,
  countOtherActiveListings,
};
