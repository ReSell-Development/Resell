/**
 * Similar Products Service
 *
 * Recommends similar products using:
 *  - Category match (strong)
 *  - Brand match
 *  - Price proximity
 *  - Condition match
 *  - Text similarity (title keywords)
 */

const Product = require('../models/Product');

const findSimilar = async (productId, limit = 6) => {
  const product = await Product.findById(productId).populate('category');
  if (!product) return [];

  // Get candidates in the same category
  const candidates = await Product.find({
    _id: { $ne: productId },
    category: product.category?._id,
    status: 'active',
  })
    .populate('category')
    .populate('seller', 'name avatar averageResponseMinutes')
    .limit(50);

  if (candidates.length === 0) {
    // Fallback: broader search
    const fallback = await Product.find({
      _id: { $ne: productId },
      status: 'active',
      $or: [{ brand: product.brand }, { category: product.category?._id }],
    })
      .populate('category')
      .populate('seller', 'name avatar averageResponseMinutes')
      .limit(limit);
    return fallback;
  }

  const scored = candidates.map((c) => {
    let score = 0;

    // Category match (already filtered, weight high)
    score += 40;

    // Brand match
    if (c.brand && product.brand && c.brand.toLowerCase() === product.brand.toLowerCase()) {
      score += 20;
    }

    // Price proximity (within ±30% range scores well)
    if (product.price > 0 && c.price > 0) {
      const diff = Math.abs(c.price - product.price) / product.price;
      if (diff < 0.2) score += 15;
      else if (diff < 0.4) score += 10;
      else if (diff < 0.6) score += 5;
    }

    // Condition match
    if (c.condition === product.condition) score += 10;

    // Model similarity
    if (c.model && product.model && c.model.toLowerCase() === product.model.toLowerCase()) {
      score += 10;
    }

    // Title keyword overlap
    if (c.title && product.title) {
      const a = new Set(product.title.toLowerCase().split(/\s+/));
      const b = new Set(c.title.toLowerCase().split(/\s+/));
      const intersection = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      score += jaccard * 5;
    }

    return { product: c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.product);
};

module.exports = { findSimilar };
