/**
 * Product Fingerprint Service (SCRUM-25)
 *
 * Builds a visual fingerprint of a physical product from the CNN
 * (MobileNet) features already extracted by the existing image
 * processing pipeline (Product.images[].cnnFeatures). This is
 * complementary to pHash (image duplicate detection) and to
 * identifier-based identity:
 *
 *   pHash              -> identical / near-duplicate IMAGES
 *   CNN fingerprint    -> physical APPEARANCE similarity
 *   Identifier         -> registry identity when available
 *   Possession         -> seller possession evidence
 *   Fraud engine       -> combined risk assessment
 *
 * Key semantics:
 *   - Same brand + model is NOT fraud (two sellers may legitimately own
 *     the same model).
 *   - High visual similarity is a SUPPORTING risk signal only, never
 *     proof that two listings are the same physical item.
 *   - Comparisons are crosswise (every image in A vs every image in B),
 *     so identical camera angles are NOT required.
 *   - When CNN features are unavailable the result is explicitly
 *     `available: false` — unavailable ML is never treated as fraud.
 *
 * Uses actual image features from the existing ML pipeline — never
 * filenames, URLs, or client-provided hashes.
 */

// Thresholds are configurable via environment variables with sane defaults.
// Medium: strong enough to be a supporting signal while staying well below
// "definitely the same item". Strong: very high similarity — still only a
// supporting signal, combined with other evidence by the fraud engine.
const envNum = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const MEDIUM_SIMILARITY_THRESHOLD = envNum('VISUAL_SIMILARITY_MEDIUM_THRESHOLD', 0.9);
const STRONG_SIMILARITY_THRESHOLD = envNum('VISUAL_SIMILARITY_STRONG_THRESHOLD', 0.97);

// Same-seller object-centric pass (background pixels must not dilute the
// comparison). Crop-vs-crop when both sides have crop embeddings; whole-image
// cosine is only a fallback when crops are missing.
const SAME_SELLER_SIM_THRESHOLD = envNum('SAME_SELLER_SIM_THRESHOLD', 0.82);
const SAME_SELLER_WHOLE_SIM_THRESHOLD = envNum('SAME_SELLER_WHOLE_SIM_THRESHOLD', 0.85);
const SAME_SELLER_CROP_COLOR_COSINE = envNum('SAME_SELLER_CROP_COLOR_COSINE', 0.78);
const SAME_SELLER_COLOR_CORR = envNum('SAME_SELLER_COLOR_CORR', 0.85);

// Maximum number of candidate listings to compare against, keeping the
// crosswise comparison bounded. Configurable via VISUAL_SCAN_CAP.
const MAX_CANDIDATES = envNum('VISUAL_SCAN_CAP', 200);

/**
 * Cosine similarity between two numeric vectors.
 * Returns null when either vector is invalid (missing, empty, or a
 * length mismatch) so callers can skip invalid pairs cleanly.
 */
const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return null;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  // Clamp to [0, 1] — negative cosine (rare for CNN embeddings) carries no
  // positive similarity meaning.
  return Math.max(0, Math.min(1, dot / denom));
};

/**
 * Collect valid per-image feature vectors from a product (or plain
 * object with images[].cnnFeatures).
 */
const validImageFeatures = (product) => {
  const images = Array.isArray(product?.images) ? product.images : [];
  return images
    .filter((img) => Array.isArray(img?.cnnFeatures) && img.cnnFeatures.length > 0)
    .map((img) => ({ url: img.url, features: img.cnnFeatures }));
};

/**
 * Primary-crop embedding of a multi-object listing (README §7.12).
 *
 * Returns the cropEmbedding of aiAnalysis.detectedObjects[primaryObjectIndex]
 * (defaulting to index 0, the highest detection score) when present, else
 * null. Crop embeddings live in the local MobileNet space — comparable
 * crop-vs-crop against other listings' crops, so a bundle photo of items
 * A+B matches a single photo of A. Length mismatches against whole-image
 * CLIP features are skipped cleanly by cosineSimilarity (returns null).
 */
const primaryCropFeatures = (product) => {
  const objects = Array.isArray(product?.aiAnalysis?.detectedObjects)
    ? product.aiAnalysis.detectedObjects
    : [];
  if (objects.length === 0) return null;
  const rawIdx = product?.aiAnalysis?.primaryObjectIndex;
  const idx = Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < objects.length ? rawIdx : 0;
  const embedding = objects[idx]?.cropEmbedding;
  return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
};

/**
 * Build a visual product fingerprint from the CNN features produced by
 * the existing ML pipeline.
 *
 * The aggregate fingerprint is the unit-normalized mean of the per-image
 * feature vectors. When the listing has multi-object detections, the
 * primary crop's embedding is included as an extra comparison vector so a
 * bundle photo matches a single photo of the same item crop-vs-crop.
 *
 * Returns { available: false, reason } — never a fraud signal — when neither
 * whole-image CNN features nor a primary crop embedding exist.
 *
 * @param {Object} product  Product document (or plain object)
 * @returns {Object} { available, reason?, fingerprint?, imageFeatures? }
 */
const buildProductFingerprint = (product) => {
  const imageFeatures = validImageFeatures(product);

  const cropEmbedding = primaryCropFeatures(product);
  if (imageFeatures.length === 0 && !cropEmbedding) {
    return { available: false, reason: 'cnn_features_unavailable' };
  }

  // The aggregate mean uses whole-image features only (single embedding
  // space). The primary crop is appended afterwards as an extra crosswise
  // comparison vector — never mixed into the mean.
  const dims = imageFeatures.length > 0 ? imageFeatures[0].features.length : 0;
  const sum = new Array(dims).fill(0);
  for (const { features } of imageFeatures) {
    if (features.length !== dims) continue;
    for (let i = 0; i < dims; i++) sum[i] += Number(features[i]) || 0;
  }

  if (cropEmbedding) {
    imageFeatures.push({ url: 'crop:primary', features: cropEmbedding });
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);

  const fingerprint = norm > 0 ? sum.map((v) => v / norm) : [];
  if (fingerprint.length === 0 && !cropEmbedding) {
    return { available: false, reason: 'cnn_features_unavailable' };
  }

  return {
    available: imageFeatures.length > 0,
    ...(fingerprint.length > 0
      ? { fingerprint, imageFeatures }
      : { imageFeatures, reason: 'whole_image_features_unavailable' }),
  };
};

/**
 * Crosswise comparison of two product fingerprints (multi-image /
 * different-angle comparison).
 *
 * For each image in A, finds the strongest valid similarity across ALL
 * images in B — identical camera angles are not required. An aggregate
 * score is calculated from the valid best matches.
 *
 * @param {Object} fingerprintA result of buildProductFingerprint (listing A)
 * @param {Object} fingerprintB result of buildProductFingerprint (listing B)
 * @returns {Object} { available, reason?, bestMatches, aggregateSimilarity, similarity }
 *   - bestMatches: strongest match for each image of A
 *   - aggregateSimilarity: mean of the valid best matches
 *   - similarity: the strongest valid single-pair similarity
 */
const compareProductFingerprints = (fingerprintA, fingerprintB) => {
  if (!fingerprintA?.available || !fingerprintB?.available) {
    return {
      available: false,
      reason: fingerprintA?.reason || fingerprintB?.reason || 'cnn_features_unavailable',
      bestMatches: [],
      aggregateSimilarity: null,
      similarity: null,
    };
  }

  const bestMatches = [];
  let similarity = null;

  for (const imgA of fingerprintA.imageFeatures) {
    let best = null;
    for (const imgB of fingerprintB.imageFeatures) {
      const score = cosineSimilarity(imgA.features, imgB.features);
      if (score === null) continue;
      if (!best || score > best.similarity) {
        best = { aUrl: imgA.url, bUrl: imgB.url, similarity: score };
      }
    }
    if (best) {
      bestMatches.push(best);
      if (similarity === null || best.similarity > similarity) {
        similarity = best.similarity;
      }
    }
  }

  const aggregateSimilarity =
    bestMatches.length > 0
      ? bestMatches.reduce((s, m) => s + m.similarity, 0) / bestMatches.length
      : null;

  return { available: bestMatches.length > 0, bestMatches, aggregateSimilarity, similarity };
};

const numericVectors = (items) =>
  (Array.isArray(items) ? items : []).filter((v) => Array.isArray(v) && v.length > 0);

const cropFieldVectors = (product, key) =>
  numericVectors(
    (Array.isArray(product?.aiAnalysis?.detectedObjects) ? product.aiAnalysis.detectedObjects : []).map(
      (object) => object?.[key]
    )
  );

/**
 * Pearson correlation of two equal-length histograms (OpenCV CORREL).
 * Returns null when either histogram is unusable.
 */
const histogramCorrelation = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return null;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    meanA += x;
    meanB += y;
  }
  meanA /= a.length;
  meanB /= a.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = Number(a[i]) - meanA;
    const db = Number(b[i]) - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return null;
  return Math.max(-1, Math.min(1, num / Math.sqrt(denA * denB)));
};

const bestPairScore = (left, right, scoreFn) => {
  let best = null;
  for (const a of left) {
    for (const b of right) {
      const score = scoreFn(a, b);
      if (score === null || !Number.isFinite(score)) continue;
      if (best === null || score > best) best = score;
    }
  }
  return best;
};

/**
 * Object-centric comparison of two listings.
 *
 * When BOTH sides have crop embeddings, similarity is max(CNN-crop, CLIP-crop)
 * best-match cosine — whole-image pixels are ignored so the background cannot
 * dilute the match. Whole-image cosine is only a fallback when crops are missing.
 */
const compareObjectCentric = (productA, productB) => {
  const cnnCropsA = cropFieldVectors(productA, 'cropEmbedding');
  const cnnCropsB = cropFieldVectors(productB, 'cropEmbedding');
  const clipCropsA = cropFieldVectors(productA, 'clipCropEmbedding');
  const clipCropsB = cropFieldVectors(productB, 'clipCropEmbedding');
  const cnnCrop = bestPairScore(cnnCropsA, cnnCropsB, cosineSimilarity);
  const clipCrop = bestPairScore(clipCropsA, clipCropsB, cosineSimilarity);
  const cropScores = [cnnCrop, clipCrop].filter((s) => typeof s === 'number');
  const cropSimilarity = cropScores.length > 0 ? Math.max(...cropScores) : null;
  const bothHaveCrops =
    (cnnCropsA.length > 0 && cnnCropsB.length > 0) || (clipCropsA.length > 0 && clipCropsB.length > 0);

  const colorCorr = bestPairScore(
    cropFieldVectors(productA, 'colorHistogram'),
    cropFieldVectors(productB, 'colorHistogram'),
    histogramCorrelation
  );

  const wholeCnn = bestPairScore(
    validImageFeatures(productA).map((img) => img.features),
    validImageFeatures(productB).map((img) => img.features),
    cosineSimilarity
  );
  const clipWholeA = numericVectors([productA?.embedding]);
  const clipWholeB = numericVectors([productB?.embedding]);
  const wholeClip = bestPairScore(clipWholeA, clipWholeB, cosineSimilarity);
  const wholeScores = [wholeCnn, wholeClip].filter((s) => typeof s === 'number');
  const wholeSimilarity = wholeScores.length > 0 ? Math.max(...wholeScores) : null;

  return {
    bothHaveCrops,
    cnnCrop,
    clipCrop,
    cropSimilarity,
    colorCorr,
    wholeCnn,
    wholeClip,
    wholeSimilarity,
    similarity: bothHaveCrops ? cropSimilarity : wholeSimilarity,
  };
};

const decideSameSellerMatch = (comparison) => {
  if (!comparison) return { matched: false, similarity: null, reason: null };
  if (comparison.bothHaveCrops) {
    if (
      typeof comparison.cropSimilarity === 'number' &&
      comparison.cropSimilarity >= SAME_SELLER_SIM_THRESHOLD
    ) {
      return { matched: true, similarity: comparison.cropSimilarity, reason: 'crop' };
    }
    if (
      typeof comparison.cropSimilarity === 'number' &&
      comparison.cropSimilarity >= SAME_SELLER_CROP_COLOR_COSINE &&
      typeof comparison.colorCorr === 'number' &&
      comparison.colorCorr >= SAME_SELLER_COLOR_CORR
    ) {
      return {
        matched: true,
        similarity: comparison.cropSimilarity,
        reason: 'crop+color',
        colorCorr: comparison.colorCorr,
      };
    }
    return { matched: false, similarity: comparison.cropSimilarity, reason: null };
  }
  if (
    typeof comparison.wholeSimilarity === 'number' &&
    comparison.wholeSimilarity >= SAME_SELLER_WHOLE_SIM_THRESHOLD
  ) {
    return { matched: true, similarity: comparison.wholeSimilarity, reason: 'whole' };
  }
  return { matched: false, similarity: comparison.wholeSimilarity, reason: null };
};

const decideCrossSellerMatch = (comparison) => {
  if (!comparison) return { matched: false, similarity: null };
  const similarity = comparison.bothHaveCrops ? comparison.cropSimilarity : comparison.wholeSimilarity;
  if (typeof similarity !== 'number') return { matched: false, similarity: null };
  return {
    matched: similarity >= MEDIUM_SIMILARITY_THRESHOLD,
    similarity,
  };
};

module.exports = {
  MEDIUM_SIMILARITY_THRESHOLD,
  STRONG_SIMILARITY_THRESHOLD,
  SAME_SELLER_SIM_THRESHOLD,
  SAME_SELLER_WHOLE_SIM_THRESHOLD,
  SAME_SELLER_CROP_COLOR_COSINE,
  SAME_SELLER_COLOR_CORR,
  MAX_CANDIDATES,
  cosineSimilarity,
  histogramCorrelation,
  buildProductFingerprint,
  compareProductFingerprints,
  compareObjectCentric,
  decideSameSellerMatch,
  decideCrossSellerMatch,
  validImageFeatures,
  primaryCropFeatures,
};
