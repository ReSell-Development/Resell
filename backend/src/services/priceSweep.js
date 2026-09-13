const Product = require('../models/Product');

const SWEEP_BATCH_SIZE = 50;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REFINEMENT_ATTEMPTS = 5;

/**
 * Finds products stuck without a refined price estimate and re-enqueues
 * price-analysis jobs for them. Called by the price-refinement-sweep
 * repeatable BullMQ job.
 *
 * @param {Object} opts
 * @param {Function} opts.enqueue - async function(productId) to enqueue a price-analysis job
 * @returns {Object} { found, enqueued, skipped, flagged }
 */
async function sweepStalePrices({ enqueue }) {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleProducts = await Product.find({
    'aiAnalysis.priceRecommendation.generatedAt': { $exists: true, $ne: null, $lte: cutoff },
    $or: [
      { 'aiAnalysis.priceRecommendation.refinedAt': { $exists: false } },
      { 'aiAnalysis.priceRecommendation.refinedAt': null },
    ],
    'aiAnalysis.priceRecommendation.refinementAttempts': { $lt: MAX_REFINEMENT_ATTEMPTS },
  })
    .limit(SWEEP_BATCH_SIZE)
    .select('_id title aiAnalysis.priceRecommendation')
    .lean();

  let enqueued = 0;
  let skipped = 0;
  let flagged = 0;

  for (const product of staleProducts) {
    const attempts = product.aiAnalysis?.priceRecommendation?.refinementAttempts || 0;

    if (attempts >= MAX_REFINEMENT_ATTEMPTS) {
      flagged++;
      console.warn(
        `[PriceSweep] Product ${product._id} ("${product.title}") exceeded max refinement attempts (${MAX_REFINEMENT_ATTEMPTS}). Flagging for manual review.`
      );
      continue;
    }

    try {
      await Product.findByIdAndUpdate(product._id, {
        $inc: { 'aiAnalysis.priceRecommendation.refinementAttempts': 1 },
      });

      await enqueue(product._id.toString());
      enqueued++;
    } catch (err) {
      skipped++;
      console.error(`[PriceSweep] Failed to enqueue for product ${product._id}: ${err.message}`);
    }
  }

  const result = {
    found: staleProducts.length,
    enqueued,
    skipped,
    flagged,
  };

  if (staleProducts.length > 0) {
    console.log(
      `[PriceSweep] Sweep complete: ${staleProducts.length} stale products found, ` +
      `${enqueued} re-enqueued, ${skipped} skipped, ${flagged} flagged`
    );
  }

  return result;
}

module.exports = { sweepStalePrices, SWEEP_BATCH_SIZE, STALE_THRESHOLD_MS, MAX_REFINEMENT_ATTEMPTS };
