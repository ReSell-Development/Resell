/**
 * Cross-seller visual-similarity buyer advisory.
 *
 * When the worker's cross-seller visual scan fires (CNN/CLIP crop or
 * whole-image cosine >= MEDIUM_SIMILARITY_THRESHOLD), the match is a
 * supporting signal only — same-model items are not fraud. Buyers still
 * benefit from knowing, so the listing carries a buyer-visible advisory
 * string rendered verbatim by the ProductDetail Trust panel.
 *
 * Escalation: a VERY strong match (>= STRONG_SIMILARITY_THRESHOLD) that
 * coincides with >= 2 other risk signals lifts an otherwise-low listing to
 * medium and flags it for the admin moderation queue (isFlagged). Status is
 * never touched — neither listing is auto-rejected by this path.
 */

const Product = require('../models/Product');
const {
  MEDIUM_SIMILARITY_THRESHOLD,
  STRONG_SIMILARITY_THRESHOLD,
} = require('./productFingerprint');

const BUYER_ADVISORY_TEXT =
  '⚠️ Visually similar to another active listing — we recommend verifying details with the seller before paying';

const ESCALATION_FACTOR =
  'Cross-seller visual match combined with multiple other risk signals — held at medium for admin review';

const ESCALATION_FLAG_REASON =
  'Cross-seller visual match plus multiple other risk signals — review advised';

// Factors produced by the visual layer — excluded when counting the "other"
// risk signals for escalation so the visual match cannot count toward its
// own quorum.
const isVisualFactor = (factor) =>
  typeof factor === 'string' && /visual (product similarity|match)/i.test(factor);

/** Advisory text for a measured cross-seller similarity, or '' when below the advisory band. */
const buildBuyerAdvisory = (similarity) =>
  typeof similarity === 'number' && similarity >= MEDIUM_SIMILARITY_THRESHOLD
    ? BUYER_ADVISORY_TEXT
    : '';

/** Number of risk factors that are NOT from the visual layer. */
const countOtherSignals = (factors = []) =>
  (Array.isArray(factors) ? factors : []).filter((f) => !isVisualFactor(f)).length;

/**
 * Escalate only an otherwise-low listing: strong visual match plus a quorum
 * of >= 2 other signals. Medium/high listings already surface without help.
 */
const needsMediumEscalation = ({ similarity, otherSignalCount, riskLevel } = {}) =>
  typeof similarity === 'number' &&
  similarity >= STRONG_SIMILARITY_THRESHOLD &&
  Number.isFinite(otherSignalCount) &&
  otherSignalCount >= 2 &&
  riskLevel !== 'medium' &&
  riskLevel !== 'high';

/**
 * Persist the advisory (and, when the escalation rule fires, the medium
 * floor + admin-queue flag) for a worker-processed listing. Idempotent:
 * re-runs set the same values and never duplicate factors or scores.
 */
const applyCrossSellerVisualOutcome = async ({ productId, similarity } = {}) => {
  const advisory = buildBuyerAdvisory(similarity);
  if (!advisory || !productId) return { advisory: '', escalated: false, otherSignalCount: 0 };

  const product = await Product.findById(productId)
    .select('status aiAnalysis.riskAssessment')
    .lean();
  if (!product) return { advisory: '', escalated: false, otherSignalCount: 0 };

  const factors = product.aiAnalysis?.riskAssessment?.factors || [];
  const otherSignalCount = countOtherSignals(factors);
  const riskLevel = product.aiAnalysis?.riskAssessment?.riskLevel || 'low';
  const escalate = needsMediumEscalation({ similarity, otherSignalCount, riskLevel });

  const update = { $set: { buyerAdvisory: advisory } };
  if (escalate) {
    update.$set.isFlagged = true;
    update.$set.flagReason = ESCALATION_FLAG_REASON;
    update.$set['aiAnalysis.riskAssessment.riskScore'] = 25;
    update.$set['aiAnalysis.riskAssessment.riskLevel'] = 'medium';
    update.$set['aiAnalysis.riskAssessment.assessedAt'] = new Date();
    update.$addToSet = { 'aiAnalysis.riskAssessment.factors': ESCALATION_FACTOR };
  }
  await Product.updateOne({ _id: productId }, update);
  return { advisory, escalated: escalate, otherSignalCount };
};

module.exports = {
  BUYER_ADVISORY_TEXT,
  ESCALATION_FACTOR,
  ESCALATION_FLAG_REASON,
  ADVISORY_SIMILARITY_THRESHOLD: MEDIUM_SIMILARITY_THRESHOLD,
  ESCALATION_SIMILARITY_THRESHOLD: STRONG_SIMILARITY_THRESHOLD,
  buildBuyerAdvisory,
  countOtherSignals,
  needsMediumEscalation,
  applyCrossSellerVisualOutcome,
};
