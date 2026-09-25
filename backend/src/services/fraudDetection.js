/**
 * Fraud / Risk Detection Service
 *
 * Detects suspicious signals:
 *  - Duplicate images across listings (perceptual hash similarity)
 *  - Suspicious pricing (way below market)
 *  - Repeated descriptions
 *  - Complaint history
 *  - New accounts with high value listings
 *  - Seller trust signals
 *  - Product identity / provenance (serial/IMEI/VIN ownership mismatch,
 *    reused identifiers, multiple active listings, stolen products)
 */

const Product = require('../models/Product');
const User = require('../models/User');
const Report = require('../models/Report');
const { hammingDistance } = require('./imageHash');

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

// Maximum hamming distance to consider two 64-bit perceptual hashes as "similar".
// Threshold of 12 validated against real photographs: catches all crop/recompress
// variants (max observed distance = 12) while producing zero false positives on
// same-category different products (min observed distance = 30, margin = 18 points).
const HASH_SIMILARITY_THRESHOLD = 12;

// Product-identity fraud signals (from identityVerification.js), combined
// with the existing risk score below.
// Note: same identifier ≠ fraud. Same identifier + legitimate ownership
// transfer = normal resale (no mismatch signals emitted). Same identifier +
// conflicting ownership / no transfer = suspicious.
const IDENTITY_SIGNAL_WEIGHTS = {
  PRODUCT_IDENTIFIER_REUSED: { weight: 10, factor: 'Product identifier (serial/IMEI) reused from another listing' },
  MULTIPLE_ACTIVE_LISTINGS: { weight: 30, factor: 'Same physical product identifier on multiple active listings' },
  OWNERSHIP_MISMATCH: { weight: 35, factor: 'Identifier registered to a different owner with no verified ownership transfer' },
  NO_VERIFIED_TRANSFER: { weight: 15, factor: 'No verified ownership transfer found for this identifier' },
  PROVENANCE_INTEGRITY_FAILURE: { weight: 45, factor: 'Provenance chain integrity failure or flagged identity' },
  REPORTED_STOLEN_PRODUCT: { weight: 100, factor: 'Product identifier reported as stolen' },
  // Supporting signal only — a FAILED attempt is suspicious; UNVERIFIED
  // (never submitted) is deliberately absent: missing verification is
  // never treated as fraud on its own.
  POSSESSION_VERIFICATION_FAILED: { weight: 10, factor: 'Proof-of-possession verification failed (incorrect verification code)' },
};

const detectRisk = async ({ product, hashes = [], aiAnalysis = {}, identitySignals = [] }) => {
  const factors = [];
  let riskScore = 0;

  // 1. Duplicate image risk — similarity-based via perceptual hashing.
  //    Scans ALL product hashes against ALL candidate hashes and reports
  //    the BEST (most similar) match, so factors reference the strongest
  //    evidence rather than whichever listing happened to be scanned first.
  if (hashes && hashes.length > 0) {
    // Fetch candidate products in the same category (or all if no category)
    const candidateFilter = {
      _id: { $ne: product._id },
      status: { $in: ['active', 'sold'] },
    };
    if (product.category) {
      candidateFilter.category = product.category;
    }

    // Limit to recent 500 candidates to keep memory usage bounded
    const candidates = await Product.find(candidateFilter)
      .select('title aiAnalysis.imageHashes')
      .limit(500);

    let bestMatch = null; // { distance, title }
    for (const candidate of candidates) {
      const candidateHashes = candidate.aiAnalysis?.imageHashes || [];
      for (const candidateHash of candidateHashes) {
        for (const hash of hashes) {
          const distance = hammingDistance(hash, candidateHash);
          if (distance <= HASH_SIMILARITY_THRESHOLD && (!bestMatch || distance < bestMatch.distance)) {
            bestMatch = { distance, title: candidate.title };
          }
        }
      }
      // Cannot do better than an exact match
      if (bestMatch?.distance === 0) break;
    }

    if (bestMatch) {
      riskScore += 35;
      const similarityPct = Math.round((1 - bestMatch.distance / 64) * 100);
      factors.push(
        `Duplicate image detected (~${similarityPct}% similar to listing "${bestMatch.title}", distance: ${bestMatch.distance})`
      );
    }
  }

  // 2. Suspicious pricing
  const sellerAccountAgeDays = product.seller?.createdAt
    ? Math.floor((Date.now() - new Date(product.seller.createdAt)) / (1000 * 60 * 60 * 24))
    : 0;

  if (product.originalPrice > 0 && product.price > 0) {
    const priceRatio = product.price / product.originalPrice;
    if (priceRatio < 0.15) {
      riskScore += 25;
      factors.push('Price is suspiciously low (<15% of original price)');
    } else if (priceRatio > 1.5) {
      riskScore += 10;
      factors.push('Price is significantly above original price');
    }
  }

  if (product.price > 5000 && sellerAccountAgeDays < 30) {
    riskScore += 15;
    factors.push('High-value listing from new account');
  }

  // 3. Repeated content (same description in many listings)
  if (product.description) {
    const dupCount = await Product.countDocuments({
      _id: { $ne: product._id },
      seller: product.seller?._id || product.seller,
      description: product.description,
    });
    if (dupCount >= 2) {
      riskScore += 20;
      factors.push(`Same description used in ${dupCount + 1} listings`);
    }
  }

  // 4. Seller complaint history
  if (product.seller) {
    const sellerId = product.seller._id || product.seller;
    const userReports = await Report.countDocuments({
      target: sellerId,
      targetType: 'user',
      status: { $in: ['pending', 'reviewing', 'resolved'] },
    });
    if (userReports > 3) {
      riskScore += 15;
      factors.push(`Seller has ${userReports} reports against them`);
    }
  }

  // 5. Risk from AI analysis
  if (aiAnalysis.damageScore >= 60) {
    riskScore += 5;
    factors.push('High damage score detected by AI');
  }

  // 6. Product identity / provenance signals (extension — combined with
  //    existing image/pricing/trust signals)
  const seenSignals = new Set();
  for (const signal of identitySignals) {
    const config = IDENTITY_SIGNAL_WEIGHTS[signal];
    if (!config || seenSignals.has(signal)) continue;
    seenSignals.add(signal);
    riskScore += config.weight;
    factors.push(config.factor);
  }

  riskScore = clamp(riskScore, 0, 100);

  let riskLevel = 'low';
  if (riskScore >= 50) riskLevel = 'high';
  else if (riskScore >= 25) riskLevel = 'medium';

  return {
    riskScore,
    riskLevel,
    factors,
  };
};

module.exports = { detectRisk };
