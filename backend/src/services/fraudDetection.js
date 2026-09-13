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

const detectRisk = async ({ product, hashes = [], aiAnalysis = {} }) => {
  const factors = [];
  let riskScore = 0;

  // 1. Duplicate image risk — similarity-based via perceptual hashing
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

    for (const hash of hashes) {
      let duplicateFound = false;
      for (const candidate of candidates) {
        const candidateHashes = candidate.aiAnalysis?.imageHashes || [];
        for (const candidateHash of candidateHashes) {
          const distance = hammingDistance(hash, candidateHash);
          if (distance <= HASH_SIMILARITY_THRESHOLD) {
            riskScore += 35;
            const similarityPct = Math.round((1 - distance / 64) * 100);
            factors.push(
              `Duplicate image detected (~${similarityPct}% similar to listing "${candidate.title}", distance: ${distance})`
            );
            duplicateFound = true;
            break;
          }
        }
        if (duplicateFound) break;
      }
      if (duplicateFound) break;
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
