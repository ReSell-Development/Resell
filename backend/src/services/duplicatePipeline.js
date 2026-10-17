/**
 * Duplicate Detection Pipeline (SCRUM-30)
 *
 * The legacy duplicate check was a single flat rule: probe every stored 64-bit
 * pHash against every other listing and hard-block on hamming distance <= 12.
 * That conflated three very different things and produced both false blocks
 * (two genuinely different photos of similar items can land inside 12) and
 * false negatives (the probe list was a bounded brute-force scan that also
 * happily compared SHA-256 fallback digests as if they were perceptual hashes).
 *
 * This module is the canonical replacement. It separates four concerns that
 * the old rule mushed together:
 *
 *   1. Hash *type* — a value is either a real 64-bit DCT pHash or it is not
 *      (`imageHash.hashKind`). Non-pHash values are never compared with
 *      Hamming math, closing the hash-type mismatch.
 *
 *   2. Candidate *retrieval* — instead of scanning up to DUPLICATE_SCAN_CAP
 *      documents, candidates are pulled through an LSH nibble-bucket index
 *      (`aiAnalysis.hashBuckets`). Two hashes within distance <= 15 are
 *      guaranteed to share a nibble, so the bucket query is a complete
 *      prefilter for the whole REVIEW band and beyond. Documents written
 *      before the index existed (or in tests that build Products directly)
 *      are picked up by an explicit "uncovered" query, so recall is identical
 *      to the legacy scan while the indexed path costs a fraction of the work.
 *
 *   3. *Transformation-aware* matching — a match is classified into
 *      'identical' / 'mirror' / 'rotation' depending on which pair of stored
 *      variants (plain / mirror / rotate90..270 / vertical-flip) produced it,
 *      recovered from the dihedral-group relationship between the two variant
 *      labels. Each relationship carries its own block/review distances,
 *      because DCT pHash is measurably less stable under rotation than under
 *      recompression.
 *
 *   4. *Two scores, not one* — `imageCopyScore` (did someone copy the actual
 *      image file?) and `physicalItemScore` (do these two listings appear to
 *      be the same physical item?) are computed and fused with metadata,
 *      seller and provenance evidence. Only image-copy evidence can block on
 *      its own; physical similarity alone is capped at REVIEW. That is the
 *      "never block solely on visual likeness" guarantee: two sellers owning
 *      the same model is normal resale, not fraud.
 *
 * The outcome is a graded ALLOW / REVIEW / BLOCK decision with fully
 * configurable thresholds (see CONFIG below).
 */

const Product = require('../models/Product');
const { hammingDistance, isPHash, hashBuckets } = require('./imageHash');
const {
  compareObjectCentric,
  MEDIUM_SIMILARITY_THRESHOLD,
  STRONG_SIMILARITY_THRESHOLD,
} = require('./productFingerprint');
const { normalizeText, charNgramJaccard } = require('./textSimilarity');

const envNum = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ── Configuration ───────────────────────────────────────────────────────────
// Distances are hamming distance on the 64-bit pHash; scores are 0..1.
//
//   DUPLICATE_*_DISTANCE  — at/below `block` distance a pair is treated as an
//                           image copy (BLOCK); between `block` and `review` it
//                           is a REVIEW; beyond `review` it is ALLOW.
//   *_BLOCK_SCORE/_REVIEW_SCORE — the same thresholds expressed on the
//                           continuous imageCopyScore / physicalItemScore
//                           scales (see imageCopyScoreFromDistance). Defaults
//                           are chosen so that the distance thresholds above
//                           map exactly onto the score thresholds.
const HASH_SIMILARITY_THRESHOLD = envNum('HASH_SIMILARITY_THRESHOLD', 12);
const DUPLICATE_BLOCK_DISTANCE = envNum('DUPLICATE_BLOCK_DISTANCE', 6);
const DUPLICATE_REVIEW_DISTANCE = envNum('DUPLICATE_REVIEW_DISTANCE', HASH_SIMILARITY_THRESHOLD);
// Rotation / flip matches are allowed a slightly wider band: re-encoding a
// rotated image perturbs the DCT coefficients more than a plain recompress.
const DUPLICATE_CROSS_BLOCK_DISTANCE = envNum('DUPLICATE_CROSS_BLOCK_DISTANCE', 8);
const DUPLICATE_CROSS_REVIEW_DISTANCE = envNum('DUPLICATE_CROSS_REVIEW_DISTANCE', 14);

const IMAGE_COPY_BLOCK_SCORE = envNum('IMAGE_COPY_BLOCK_SCORE', 0.9);
const IMAGE_COPY_REVIEW_SCORE = envNum('IMAGE_COPY_REVIEW_SCORE', 0.75);
// A physical-item match must be extremely strong AND corroborated by
// non-visual evidence before it can block on its own.
const PHYSICAL_ITEM_BLOCK_SCORE = envNum('PHYSICAL_ITEM_BLOCK_SCORE', 0.97);
const PHYSICAL_ITEM_REVIEW_SCORE = envNum('PHYSICAL_ITEM_REVIEW_SCORE', 0.9);

const DUPLICATE_SCAN_CAP = envNum('DUPLICATE_SCAN_CAP', 500);
const PHYSICAL_SCAN_CAP = envNum('VISUAL_SCAN_CAP', 200);

const DECISION = { ALLOW: 'ALLOW', REVIEW: 'REVIEW', BLOCK: 'BLOCK' };

// ── Variant labels / dihedral-group relationships ───────────────────────────
// A stored "variant" is the pHash of a transformed copy of the same source
// image. `plain` is the untouched image; `mirror` is a horizontal flop;
// `r90/r180/r270` are clockwise rotations; `vflip` is a vertical flip.
const TRANSFORMS = ['plain', 'mirror', 'r90', 'r180', 'r270', 'vflip'];
const ROTATION_LABELS = ['r90', 'r180', 'r270'];

// D4 (symmetries of the square) encoding: an element is rotate-by-k*90
// followed by an optional horizontal flip `f`.
const TRANSFORM_GROUPS = {
  plain: { k: 0, f: 0 },
  r90: { k: 1, f: 0 },
  r180: { k: 2, f: 0 },
  r270: { k: 3, f: 0 },
  mirror: { k: 0, f: 1 },
  // A vertical flip equals a horizontal flip composed with a 180 rotation.
  vflip: { k: 2, f: 1 },
};

const mod4 = (n) => ((n % 4) + 4) % 4;

// g ∘ h — apply h first, then g.
const composeD4 = (g, h) =>
  g.f === 0
    ? { k: mod4(g.k + h.k), f: h.f }
    : { k: mod4(g.k - h.k), f: (h.f + 1) % 2 };

// Rotations invert by negation; reflections are self-inverse.
const invertD4 = (g) => (g.f === 0 ? { k: mod4(-g.k), f: 0 } : { k: g.k, f: 1 });

const normalizeTransform = (value) => {
  const t = String(value || '').trim();
  return TRANSFORMS.includes(t) ? t : 'plain';
};

/**
 * Classify the geometric relationship between two variant labels.
 *
 * If a probe variant `t_p` matches a candidate variant `t_c` then the probe
 * image equals the candidate image transformed by X = t_p^-1 ∘ t_c:
 *   X = identity -> the two are the same picture ('identical')
 *   X = rotation -> one is a rotation of the other ('rotation')
 *   X = reflection -> one is a mirror of the other ('mirror')
 */
const relationshipOf = (probeTransform, candidateTransform) => {
  const g = TRANSFORM_GROUPS[normalizeTransform(probeTransform)];
  const h = TRANSFORM_GROUPS[normalizeTransform(candidateTransform)];
  const x = composeD4(invertD4(g), h);
  if (x.f === 0 && x.k === 0) return 'identical';
  if (x.f === 0) return 'rotation';
  return 'mirror';
};

// Lower is a better explanation of the same distance.
const RELATIONSHIP_PRIORITY = { identical: 0, mirror: 1, rotation: 2 };

const relationshipThresholds = (relationship) => {
  switch (relationship) {
    case 'rotation':
      return { block: DUPLICATE_CROSS_BLOCK_DISTANCE, review: DUPLICATE_CROSS_REVIEW_DISTANCE };
    case 'mirror':
      return { block: DUPLICATE_BLOCK_DISTANCE, review: DUPLICATE_REVIEW_DISTANCE };
    case 'identical':
    default:
      return { block: DUPLICATE_BLOCK_DISTANCE, review: DUPLICATE_REVIEW_DISTANCE };
  }
};

/**
 * Map a hamming distance onto a continuous 0..1 image-copy score, using the
 * relationship-specific break points. The curve is continuous and monotonically
 * decreasing, and is constructed so that:
 *   distance <= block            -> score >= IMAGE_COPY_BLOCK_SCORE  (BLOCK)
 *   block < distance <= review   -> score in [REVIEW, BLOCK)          (REVIEW)
 *   distance > review            -> score <  IMAGE_COPY_REVIEW_SCORE  (ALLOW)
 * With the defaults (block 6, review 12, 0.90 / 0.75) this reproduces the
 * documented pHash bands exactly while staying configurable end-to-end.
 */
const imageCopyScoreFromDistance = (distance, thresholds = relationshipThresholds('identical')) => {
  if (!Number.isFinite(distance)) return 0;
  const block = Math.max(0, thresholds.block);
  const review = Math.max(block + 1, thresholds.review);
  if (distance <= block) {
    if (block === 0) return 1;
    return IMAGE_COPY_BLOCK_SCORE + (1 - IMAGE_COPY_BLOCK_SCORE) * (1 - distance / block);
  }
  if (distance <= review) {
    const t = (distance - block) / (review - block);
    return IMAGE_COPY_BLOCK_SCORE - (IMAGE_COPY_BLOCK_SCORE - IMAGE_COPY_REVIEW_SCORE) * t;
  }
  const t = Math.min(1, (distance - review) / Math.max(1, 64 - review));
  return IMAGE_COPY_REVIEW_SCORE * (1 - t);
};

// ── Typed hash sets ─────────────────────────────────────────────────────────

/**
 * Normalise any single stored hash entry into `{ transform, value }`. Used for
 * both the probe side (freshly computed variants) and the candidate side.
 */
const normalizeVariant = (value, transform = 'plain') => ({
  transform: normalizeTransform(transform),
  value: typeof value === 'string' && value.length > 0 ? value : null,
});

/**
 * Build the typed variant list for one freshly hashed image, keyed by which
 * transformation produced each entry. `imageHashes`/`mirrorHashes`/etc. lists
 * on a stored document lose the per-image pairing, so callers that still have
 * the raw per-image record should prefer this over typedHashSetFromAnalysis.
 */
const typedVariantsFromImages = (images = []) => {
  const variants = [];
  for (const image of images || []) {
    if (!image) continue;
    if (image.hash) variants.push({ transform: 'plain', value: image.hash });
    if (image.mirrorHash) variants.push({ transform: 'mirror', value: image.mirrorHash });
    const rotations = Array.isArray(image.rotationHashes)
      ? image.rotationHashes
      : image.rotationHashes
        ? [image.rotationHashes]
        : [];
    rotations.forEach((value, idx) => {
      if (value) variants.push({ transform: ROTATION_LABELS[idx] || 'r90', value });
    });
    const vflips = Array.isArray(image.vflipHash) ? image.vflipHash : image.vflipHash ? [image.vflipHash] : [];
    vflips.forEach((value) => {
      if (value) variants.push({ transform: 'vflip', value });
    });
  }
  return variants;
};

/**
 * Typed variant list for a stored document's `aiAnalysis`.
 *
 * Newer documents carry an explicit `aiAnalysis.hashVariants` list that keeps
 * the per-image plain/mirror/rotation pairing. Older documents only carry the
 * flat `imageHashes` list (normal + mirror entries with no labels) plus the
 * rotation/vflip arrays — those entries are labelled `plain`, which is correct
 * for a normal entry and still produces the right relationship for a mirrored
 * upload (plain-vs-mirror resolves to 'mirror' below).
 */
const typedHashSetFromAnalysis = (aiAnalysis = {}) => {
  const analysis = aiAnalysis || {};
  if (Array.isArray(analysis.hashVariants) && analysis.hashVariants.length > 0) {
    return analysis.hashVariants
      .map((v) => normalizeVariant(v?.value, v?.transform))
      .filter((v) => v.value !== null);
  }

  const variants = [];
  (Array.isArray(analysis.imageHashes) ? analysis.imageHashes : []).forEach((value) => {
    if (value) variants.push(normalizeVariant(value, 'plain'));
  });
  (Array.isArray(analysis.mirrorHashes) ? analysis.mirrorHashes : []).forEach((value) => {
    if (value) variants.push(normalizeVariant(value, 'mirror'));
  });
  const rotations = Array.isArray(analysis.rotationHashes) ? analysis.rotationHashes : [];
  rotations.forEach((value, idx) => {
    if (value) variants.push(normalizeVariant(value, ROTATION_LABELS[idx] || 'r90'));
  });
  const vflips = Array.isArray(analysis.vflipHash) ? analysis.vflipHash : analysis.vflipHash ? [analysis.vflipHash] : [];
  vflips.forEach((value) => {
    if (value) variants.push(normalizeVariant(value, 'vflip'));
  });
  return variants;
};

/**
 * LSH nibble buckets + typed variants to persist alongside a product's hashes.
 * Buckets make the candidate query indexed; variants preserve transform labels.
 */
const hashIndexFromVariants = (variants = []) => {
  const buckets = new Set();
  for (const variant of variants || []) {
    if (!variant?.value) continue;
    for (const bucket of hashBuckets(variant.value)) buckets.add(bucket);
  }
  return { hashVariants: variants || [], hashBuckets: [...buckets] };
};

/**
 * Merge any number of variant lists, de-duplicating by (transform, value).
 * Used when a re-analysis must union the stored variants with freshly
 * computed ones without dropping either side's transform labels.
 */
const mergeVariants = (...lists) => {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const variant of list || []) {
      if (!variant?.value) continue;
      const transform = normalizeTransform(variant.transform);
      const key = `${transform}|${variant.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ transform, value: variant.value });
    }
  }
  return merged;
};

const hashIndexFromAnalysis = (aiAnalysis = {}) => {
  const variants = typedHashSetFromAnalysis(aiAnalysis);
  const legacy = [
    ...(Array.isArray(aiAnalysis?.imageHashes) ? aiAnalysis.imageHashes : []),
    ...(Array.isArray(aiAnalysis?.rotationHashes) ? aiAnalysis.rotationHashes : []),
    ...(Array.isArray(aiAnalysis?.vflipHash) ? aiAnalysis.vflipHash : []),
  ];
  // Prefer the explicit variant list; fall back to the union of whatever hash
  // lists exist so partially written documents still get buckets.
  const values = variants.length > 0 ? variants.map((v) => v.value) : legacy.filter(Boolean);
  return hashIndexFromVariants(values.map((value) => ({ transform: 'plain', value })));
};

// ── Matching ────────────────────────────────────────────────────────────────

const isBetterMatch = (candidate, best) => {
  if (!best) return true;
  if (candidate.distance !== best.distance) return candidate.distance < best.distance;
  const a = RELATIONSHIP_PRIORITY[candidate.relationship] ?? 3;
  const b = RELATIONSHIP_PRIORITY[best.relationship] ?? 3;
  return a < b;
};

/**
 * Compare a probe variant list against a candidate variant list, returning the
 * single best (closest) pHash pair together with its relationship. Non-pHash
 * entries on either side are skipped entirely — they are a different value
 * space (see imageHash.hashKind) and comparing them would be meaningless.
 */
const compareHashSets = (probeVariants = [], candidateVariants = []) => {
  let best = null;
  for (const probe of probeVariants) {
    if (!probe?.value || !isPHash(probe.value)) continue;
    for (const candidate of candidateVariants) {
      if (!candidate?.value || !isPHash(candidate.value)) continue;
      const distance = hammingDistance(probe.value, candidate.value);
      // null = unequal length / non-pHash (should be impossible after the
      // isPHash gate, but keep the pinned contract) — skip the pair.
      if (distance === null || distance === undefined) continue;
      const match = {
        distance,
        relationship: relationshipOf(probe.transform, candidate.transform),
        probe: { transform: probe.transform, value: probe.value },
        candidate: { transform: candidate.transform, value: candidate.value },
      };
      if (isBetterMatch(match, best)) best = match;
    }
  }
  return best;
};

// ── Candidate retrieval (indexed + legacy fallback) ─────────────────────────

const buildGateFilter = ({ excludeProductId, categories, statuses = ['active', 'sold'] } = {}) => {
  const filter = { status: { $in: statuses } };
  if (excludeProductId) filter._id = { $ne: excludeProductId };
  const list = (Array.isArray(categories) ? categories : [categories]).filter(Boolean);
  if (list.length === 1) filter.category = list[0];
  else if (list.length > 1) filter.category = { $in: list };
  // Only documents that actually hold hashes can ever match; keeps the legacy
  // scan (and the uncovered query below) from dragging in every listing.
  filter['aiAnalysis.imageHashes'] = { $exists: true, $ne: [] };
  return filter;
};

/**
 * Pull the set of listings that could possibly contain a pHash within the
 * REVIEW band of any probe variant.
 *
 * Indexed path: probe every variant's 16 nibble buckets against the
 * `aiAnalysis.hashBuckets` multikey index. Pigeonhole guarantees any pair at
 * distance <= 15 shares a bucket, so this is a complete prefilter.
 *
 * Legacy path: documents without buckets (written before the index existed, or
 * created directly in tests) cannot be prefiltered, so they are fetched with a
 * bounded scan and unioned in. Recall therefore never regresses relative to
 * the old brute-force scan; on an indexed corpus the uncovered query matches
 * nothing and the scan disappears.
 */
const retrieveDuplicateCandidates = async ({
  probeVariants = [],
  baseFilter,
  model = Product,
  cap = DUPLICATE_SCAN_CAP,
} = {}) => {
  const bucketValues = [
    ...new Set(
      probeVariants
        .filter((v) => v?.value && isPHash(v.value))
        .flatMap((v) => hashBuckets(v.value))
    ),
  ];

  const indexedHits = [];
  if (bucketValues.length > 0) {
    const rows = await model
      .find({ ...baseFilter, 'aiAnalysis.hashBuckets': { $in: bucketValues } })
      .select('title seller category aiAnalysis.imageHashes aiAnalysis.rotationHashes aiAnalysis.vflipHash aiAnalysis.hashVariants aiAnalysis.hashBuckets')
      .limit(cap)
      .lean();
    indexedHits.push(...rows);
  }

  // Documents with no bucket index at all — always scanned so legacy rows are
  // never silently dropped by the indexed path.
  const uncovered = await model
    .find({
      ...baseFilter,
      $or: [{ 'aiAnalysis.hashBuckets': { $exists: false } }, { 'aiAnalysis.hashBuckets': { $size: 0 } }],
    })
    .select('title seller category aiAnalysis.imageHashes aiAnalysis.rotationHashes aiAnalysis.vflipHash aiAnalysis.hashVariants aiAnalysis.hashBuckets')
    .limit(cap)
    .lean();

  const byId = new Map();
  for (const row of [...indexedHits, ...uncovered]) {
    const key = String(row._id);
    if (!byId.has(key)) byId.set(key, row);
  }

  return {
    candidates: [...byId.values()],
    mode: uncovered.length > 0 ? 'legacy-scan' : 'indexed',
    indexedHits: indexedHits.length,
    uncovered: uncovered.length,
  };
};

const bestHashMatch = (probeVariants = [], candidates = []) => {
  let best = null;
  for (const candidate of candidates) {
    const candidateVariants = typedHashSetFromAnalysis(candidate.aiAnalysis);
    const comparison = compareHashSets(probeVariants, candidateVariants);
    if (!comparison) continue;
    if (isBetterMatch(comparison, best)) {
      best = {
        ...comparison,
        candidateId: candidate._id,
        candidateTitle: candidate.title,
        candidateSeller: candidate.seller,
        candidateCategory: candidate.category,
      };
    }
  }
  return best;
};

/**
 * Evaluate one or more probe variant lists against the corpus. Used by the
 * upload gate (before any Cloudinary write) and the edit gate (before any
 * partial update). Returns one graded decision per probe.
 */
const evaluateDuplicateGate = async ({
  probeSets = [],
  excludeProductId = null,
  categories = null,
  model = Product,
  cap = DUPLICATE_SCAN_CAP,
} = {}) => {
  const baseFilter = buildGateFilter({ excludeProductId, categories });
  const flatProbes = probeSets.flat().filter((v) => v?.value && isPHash(v.value));

  const { candidates, mode, indexedHits, uncovered } = await retrieveDuplicateCandidates({
    probeVariants: flatProbes,
    baseFilter,
    model,
    cap,
  });

  const results = probeSets.map((probeVariants) => {
    const best = bestHashMatch(probeVariants, candidates);
    const imageCopyScore = best
      ? imageCopyScoreFromDistance(best.distance, relationshipThresholds(best.relationship))
      : 0;
    const decision = decideDuplicate({ imageCopyScore, physicalItemScore: 0 });
    return { best, imageCopyScore, decision: decision.decision, reasons: decision.reasons };
  });

  return {
    results,
    candidatesCompared: candidates.length,
    retrieval: { mode, indexedHits, uncovered },
  };
};

// ── Evidence fusion ─────────────────────────────────────────────────────────

/**
 * Combine image-copy and physical-item evidence with the non-visual evidence
 * gathered around a listing. The two scores are kept separate on purpose:
 * `imageCopyScore` answers "was this photo copied?" while `physicalItemScore`
 * answers "is this the same physical item?" — they are not interchangeable.
 */
const fuseDuplicateEvidence = ({
  imageCopyScore = 0,
  physicalItemScore = 0,
  evidence = {},
} = {}) => {
  const clean = {
    sameSeller: !!evidence.sameSeller,
    sameCategory: !!evidence.sameCategory,
    sameDescription: !!evidence.sameDescription,
    identityOrProvenance: !!evidence.identityOrProvenance,
    repeatRelist: !!evidence.repeatRelist,
    sameModel: !!evidence.sameModel,
  };

  // Non-visual corroboration — the only thing that lets a physical-item match
  // escalate beyond REVIEW. Visual similarity alone is never enough.
  const corroborated =
    clean.identityOrProvenance ||
    clean.repeatRelist ||
    (clean.sameSeller && clean.sameDescription);

  return {
    imageCopyScore: clamp01(imageCopyScore),
    physicalItemScore: clamp01(physicalItemScore),
    evidence: clean,
    corroborated,
  };
};

const clamp01 = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/**
 * Graded duplicate decision.
 *
 *   BLOCK  — near-identical pHash copy (image-copy evidence is standalone
 *            proof the *image file* was reused), OR an extremely strong
 *            physical-item match that is ALSO corroborated by non-visual
 *            evidence (identity/provenance conflict, same seller re-listing
 *            the same description, ...).
 *   REVIEW — strong-but-not-conclusive image-copy evidence, OR strong visual
 *            physical-item similarity with no corroboration. Surfaced for a
 *            human, never blocks.
 *   ALLOW  — everything else.
 *
 * The hard guarantee is that `physicalItemScore` on its own can never reach
 * BLOCK: two sellers legitimately owning the same model is normal resale.
 */
const decideDuplicate = ({
  imageCopyScore = 0,
  physicalItemScore = 0,
  corroborated = false,
  evidence = {},
} = {}) => {
  const fused = fuseDuplicateEvidence({ imageCopyScore, physicalItemScore, evidence });
  // An explicit corroboration override (e.g. identity/provenance resolved by
  // the caller before the visual evidence) can only ever ADD corroboration,
  // never remove what the evidence already established.
  if (corroborated) fused.corroborated = true;
  const reasons = [];

  if (fused.imageCopyScore >= IMAGE_COPY_BLOCK_SCORE) {
    reasons.push(
      `Image-copy evidence: near-identical perceptual hash (score ${fused.imageCopyScore.toFixed(2)})`
    );
    return { decision: DECISION.BLOCK, reasons, ...fused };
  }

  if (fused.physicalItemScore >= PHYSICAL_ITEM_BLOCK_SCORE && fused.corroborated) {
    reasons.push(
      `Corroborated physical-item match (score ${fused.physicalItemScore.toFixed(2)}) backed by non-visual evidence`
    );
    return { decision: DECISION.BLOCK, reasons, ...fused };
  }

  if (fused.imageCopyScore >= IMAGE_COPY_REVIEW_SCORE) {
    reasons.push(
      `Probable image copy (score ${fused.imageCopyScore.toFixed(2)}) — within the review band, not conclusive enough to block`
    );
  }
  if (fused.physicalItemScore >= PHYSICAL_ITEM_REVIEW_SCORE) {
    reasons.push(
      `Visual physical-item similarity (score ${fused.physicalItemScore.toFixed(2)}) — same appearance is not proof of a duplicate`
    );
  }

  if (reasons.length > 0) {
    return { decision: DECISION.REVIEW, reasons, ...fused };
  }
  return { decision: DECISION.ALLOW, reasons: [], ...fused };
};

// ── Whole-listing assessment (DB-aware) ─────────────────────────────────────

const sellerKeyOf = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return String(value._id || value.toString());
  return String(value);
};

/**
 * Best cross-listing physical-item match (object-centric CNN crops + whole
 * image fallback) for a stored listing. Returns null when nothing comparable
 * exists — CNN features come from the ML service and are frequently absent.
 */
const findBestPhysicalMatch = async ({
  product,
  excludeProductId = null,
  model = Product,
  cap = PHYSICAL_SCAN_CAP,
} = {}) => {
  const excluded = [product._id];
  if (excludeProductId) excluded.push(excludeProductId);

  const filter = { _id: { $nin: excluded }, status: { $in: ['active', 'sold'] } };
  if (product.category) filter.category = product.category;

  const candidates = await model
    .find(filter)
    .select('title seller status category description images.cnnFeatures embedding aiAnalysis.detectedObjects aiAnalysis.imageHashes')
    .limit(cap)
    .lean();

  let best = null;
  for (const candidate of candidates) {
    const comparison = compareObjectCentric(product, candidate);
    if (!comparison) continue;
    const similarity = comparison.similarity;
    if (typeof similarity !== 'number' || Number.isNaN(similarity)) continue;
    if (!best || similarity > best.similarity) {
      best = { similarity, candidate, bothHaveCrops: !!comparison.bothHaveCrops };
    }
  }
  return best;
};

/**
 * Assess a stored listing for duplication against the corpus and produce the
 * graded decision plus both scores. Purely additive: it never mutates the
 * product, and callers persist the returned object if they want it stored.
 *
 * Best-effort by design — every DB/ML-dependent piece degrades to "no
 * evidence" rather than throwing, so a missing CNN feature vector can only
 * lower confidence, never fail a listing.
 */
const assessDuplicate = async ({
  product,
  excludeProductId = null,
  identityOrProvenance = false,
  model = Product,
} = {}) => {
  if (!product?._id) return null;

  // 1. Image-copy evidence — indexed pHash probe scoped to the listing's
  //    own category (same scope the legacy edit gate used).
  const probeVariants = typedHashSetFromAnalysis(product.aiAnalysis);
  const { results, retrieval } = await evaluateDuplicateGate({
    probeSets: [probeVariants],
    excludeProductId: product._id,
    categories: product.category ? [product.category] : null,
    model,
  });
  const copyResult = results[0] || { best: null, imageCopyScore: 0 };

  // 2. Physical-item evidence — object-centric visual similarity.
  let physicalItemScore = 0;
  let bestPhysical = null;
  try {
    bestPhysical = await findBestPhysicalMatch({ product, excludeProductId, model });
    physicalItemScore = bestPhysical ? clamp01(bestPhysical.similarity) : 0;
  } catch (err) {
    physicalItemScore = 0;
  }

  // 3. Non-visual evidence gathered around whichever match we found.
  const sellerKey = sellerKeyOf(product.seller);
  const physicalSellerKey = bestPhysical ? sellerKeyOf(bestPhysical.candidate?.seller) : null;
  const copySellerKey = copyResult.best ? sellerKeyOf(copyResult.best.candidateSeller) : null;

  const description = normalizeText(product.description);
  const candidateDescription = normalizeText(
    bestPhysical?.candidate?.description || copyResult.best?.candidateTitle
  );
  const sameDescription =
    !!description && !!candidateDescription && (description === candidateDescription ||
      charNgramJaccard(description, candidateDescription) >= 0.85);

  const sameSeller = (physicalSellerKey && physicalSellerKey === sellerKey) ||
    (copySellerKey && copySellerKey === sellerKey);

  const sameModel = !!(
    bestPhysical &&
    product.model &&
    bestPhysical.candidate?.model &&
    String(product.model).trim().toLowerCase() ===
      String(bestPhysical.candidate.model).trim().toLowerCase()
  );

  const repeatRelist = !!(
    sameSeller && bestPhysical && bestPhysical.candidate?.status === 'sold'
  );

  const decision = decideDuplicate({
    imageCopyScore: copyResult.imageCopyScore,
    physicalItemScore,
    evidence: {
      sameSeller: !!sameSeller,
      sameCategory: !!product.category,
      sameDescription,
      identityOrProvenance,
      repeatRelist,
      sameModel,
    },
  });

  return {
    decision: decision.decision,
    imageCopyScore: decision.imageCopyScore,
    physicalItemScore: decision.physicalItemScore,
    evidence: decision.evidence,
    corroborated: decision.corroborated,
    reasons: decision.reasons,
    imageCopy: copyResult.best
      ? {
          productId: copyResult.best.candidateId ? String(copyResult.best.candidateId) : null,
          title: copyResult.best.candidateTitle || '',
          distance: copyResult.best.distance,
          relationship: copyResult.best.relationship,
        }
      : null,
    physicalItem: bestPhysical
      ? {
          productId: String(bestPhysical.candidate._id),
          title: bestPhysical.candidate.title,
          similarity: bestPhysical.similarity,
        }
      : null,
    retrieval,
    thresholds: {
      imageCopyBlockScore: IMAGE_COPY_BLOCK_SCORE,
      imageCopyReviewScore: IMAGE_COPY_REVIEW_SCORE,
      physicalItemBlockScore: PHYSICAL_ITEM_BLOCK_SCORE,
      physicalItemReviewScore: PHYSICAL_ITEM_REVIEW_SCORE,
    },
    assessedAt: new Date(),
  };
};

module.exports = {
  DECISION,
  TRANSFORMS,
  ROTATION_LABELS,
  RELATIONSHIP_PRIORITY,
  normalizeTransform,
  relationshipOf,
  relationshipThresholds,
  imageCopyScoreFromDistance,
  normalizeVariant,
  typedVariantsFromImages,
  typedHashSetFromAnalysis,
  hashIndexFromVariants,
  hashIndexFromAnalysis,
  mergeVariants,
  compareHashSets,
  buildGateFilter,
  retrieveDuplicateCandidates,
  bestHashMatch,
  evaluateDuplicateGate,
  fuseDuplicateEvidence,
  decideDuplicate,
  findBestPhysicalMatch,
  assessDuplicate,
  // Configuration (read-only surface for tests / documentation).
  HASH_SIMILARITY_THRESHOLD,
  DUPLICATE_BLOCK_DISTANCE,
  DUPLICATE_REVIEW_DISTANCE,
  DUPLICATE_CROSS_BLOCK_DISTANCE,
  DUPLICATE_CROSS_REVIEW_DISTANCE,
  IMAGE_COPY_BLOCK_SCORE,
  IMAGE_COPY_REVIEW_SCORE,
  PHYSICAL_ITEM_BLOCK_SCORE,
  PHYSICAL_ITEM_REVIEW_SCORE,
  MEDIUM_SIMILARITY_THRESHOLD,
  STRONG_SIMILARITY_THRESHOLD,
};
