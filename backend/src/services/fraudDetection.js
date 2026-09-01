/**
 * Fraud / Risk Detection Service
 *
 * Detects suspicious signals:
 *  - Duplicate images across listings
 *  - Suspicious pricing (way below market)
 *  - Repeated descriptions
 *  - Complaint history
 *  - New accounts with high value listings
 *  - Seller trust signals
 */

const Product = require('../models/Product');
const User = require('../models/User');
const Report = require('../models/Report');

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

const detectRisk = async ({ product, hashes = [], aiAnalysis = {} }) => {
  const factors = [];
  let riskScore = 0;

  // 1. Duplicate image risk
  if (hashes && hashes.length > 0) {
    for (const hash of hashes) {
      const dup = await Product.findOne({
        _id: { $ne: product._id },
        status: { $in: ['active', 'sold'] },
        'aiAnalysis.imageHashes': hash,
      });
      if (dup) {
        riskScore += 35;
        factors.push(`Duplicate image detected (matches listing "${dup.title}")`);
        break;
      }
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
