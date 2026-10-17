/**
 * SCRUM-30 — Duplicate Detection Pipeline unit tests (pure, no DB/boot).
 *
 * Locks the contracts the graded duplicate pipeline is built on:
 *   - hash *type* separation (pHash vs sha256 fallback) — the mismatch fix
 *   - LSH nibble-bucket completeness (the pigeonhole prefilter)
 *   - dihedral-group transformation classification
 *   - image-copy score banding and the "never block on looks alone" guard
 *   - evidence fusion + graded ALLOW/REVIEW/BLOCK decisions
 *   - indexed + legacy-fallback candidate retrieval over a fake Mongoose model
 */

const {
  DECISION,
  TRANSFORMS,
  relationshipOf,
  relationshipThresholds,
  imageCopyScoreFromDistance,
  normalizeTransform,
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
  DUPLICATE_BLOCK_DISTANCE,
  DUPLICATE_REVIEW_DISTANCE,
  DUPLICATE_CROSS_BLOCK_DISTANCE,
  DUPLICATE_CROSS_REVIEW_DISTANCE,
  IMAGE_COPY_BLOCK_SCORE,
  IMAGE_COPY_REVIEW_SCORE,
  PHYSICAL_ITEM_BLOCK_SCORE,
  PHYSICAL_ITEM_REVIEW_SCORE,
} = require('../services/duplicatePipeline');

const {
  hammingDistance,
  isPHash,
  hashKind,
  hashBuckets,
  SHA256_PREFIX,
} = require('../services/imageHash');

// ── helpers ─────────────────────────────────────────────────────────────────

/** 16-char hex hash with exactly `bits` low bits set. */
const hashWithBits = (bits) => {
  let value = 0n;
  for (let i = 0; i < bits; i++) value |= 1n << BigInt(i);
  return value.toString(16).padStart(16, '0');
};

const sha = (char = 'a') => SHA256_PREFIX + char.repeat(64);

// ── fake Mongoose model ─────────────────────────────────────────────────────
// Supports exactly the query operators retrieveDuplicateCandidates uses
// ($in / $nin / $ne / $exists / $size / $or) so retrieval can be tested
// without a database connection.

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const getPath = (obj, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const matchField = (value, cond) => {
  const isOp =
    cond !== null &&
    typeof cond === 'object' &&
    !Array.isArray(cond) &&
    Object.keys(cond).some((k) => k.startsWith('$'));
  if (!isOp) return deepEqual(value, cond);

  for (const [op, arg] of Object.entries(cond)) {
    if (op === '$ne' && deepEqual(value, arg)) return false;
    if (op === '$in') {
      const list = Array.isArray(value) ? value : [value];
      if (!list.some((v) => arg.includes(v))) return false;
    }
    if (op === '$nin') {
      const list = Array.isArray(value) ? value : [value];
      if (list.some((v) => arg.includes(v))) return false;
    }
    if (op === '$exists' && (value !== undefined) !== !!arg) return false;
    if (op === '$size' && (!Array.isArray(value) || value.length !== arg)) return false;
  }
  return true;
};

const matchFilter = (row, filter) => {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      if (!cond.some((c) => matchFilter(row, c))) return false;
      continue;
    }
    if (!matchField(getPath(row, key), cond)) return false;
  }
  return true;
};

const makeModel = (rows) => ({
  rows,
  find(filter) {
    let out = rows.filter((r) => matchFilter(r, filter));
    const query = {
      select() {
        return query;
      },
      limit(n) {
        out = out.slice(0, n);
        return query;
      },
      lean() {
        return Promise.resolve(out);
      },
      then(resolve, reject) {
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return query;
  },
});

/** Row shaped like the projection retrieveDuplicateCandidates selects. */
const mongoRow = (id, hashes, opts = {}) => {
  const ai = { imageHashes: hashes };
  if (opts.buckets !== false) {
    ai.hashBuckets = [...new Set(hashes.flatMap((h) => hashBuckets(h)))];
  }
  if (opts.hashVariants) ai.hashVariants = opts.hashVariants;
  return {
    _id: id,
    title: opts.title || `listing-${id}`,
    seller: opts.seller || `seller-${id}`,
    category: opts.category || 'cat-1',
    status: opts.status || 'active',
    aiAnalysis: ai,
  };
};

/** Same gate math evaluateDuplicateGate applies for a single probe set. */
const gateFor = (probeVariants, candidates) => {
  const best = bestHashMatch(probeVariants, candidates);
  const imageCopyScore = best
    ? imageCopyScoreFromDistance(best.distance, relationshipThresholds(best.relationship))
    : 0;
  return { best, imageCopyScore, ...decideDuplicate({ imageCopyScore }) };
};

const fullImage = () => ({
  hash: '0000000000000000',
  mirrorHash: '1111111111111111',
  rotationHashes: ['2222222222222222', '3333333333333333', '4444444444444444'],
  vflipHash: '5555555555555555',
});

// ── 1. Hash type separation ─────────────────────────────────────────────────

describe('SCRUM-30 hash type separation', () => {
  it('classifies pHash, sha256 fallback, empty and garbage distinctly', () => {
    expect(hashKind('0000000000000000')).toBe('pHash');
    expect(hashKind('abcdef0123456789')).toBe('pHash');
    expect(hashKind(sha())).toBe('sha256');
    expect(hashKind('a'.repeat(64))).toBe('other'); // untagged legacy digest
    expect(hashKind('')).toBe('empty');
    expect(hashKind(null)).toBe('empty');
    expect(hashKind(undefined)).toBe('empty');
    expect(hashKind(12345)).toBe('empty');
  });

  it('isPHash only accepts a real 16-char hex pHash', () => {
    expect(isPHash('0000000000000000')).toBe(true);
    expect(isPHash('ABCDEF0123456789')).toBe(false); // uppercase is not the stored form
    expect(isPHash('000000000000000')).toBe(false); // 15 chars
    expect(isPHash(sha())).toBe(false);
  });

  it('compareHashSets never compares non-pHash entries', () => {
    const probe = [
      { transform: 'plain', value: sha('a') },
      { transform: 'plain', value: '0000000000000000' },
    ];
    const candidate = [
      { transform: 'plain', value: sha('a') }, // same sha256 — must NOT create a match
      { transform: 'plain', value: '0000000000000003' },
    ];
    const best = compareHashSets(probe, candidate);
    expect(best.distance).toBe(2);
    expect(best.relationship).toBe('identical');
  });

  it('returns null when only non-pHash values are present', () => {
    expect(
      compareHashSets(
        [{ transform: 'plain', value: sha('a') }],
        [{ transform: 'plain', value: sha('a') }]
      )
    ).toBeNull();
  });
});

// ── 2. LSH nibble buckets ───────────────────────────────────────────────────

describe('SCRUM-30 LSH nibble buckets', () => {
  it('emits 16 "<index>:<nibble>" buckets for a pHash and none otherwise', () => {
    const buckets = hashBuckets('0a0b0c0d0e0f1234');
    expect(buckets).toHaveLength(16);
    expect(buckets[0]).toBe('0:0');
    expect(buckets[1]).toBe('1:a');
    expect(buckets[15]).toBe('15:4');
    expect(hashBuckets(sha())).toEqual([]);
    expect(hashBuckets(null)).toEqual([]);
  });

  it('any pair within distance <= 15 shares at least one bucket (pigeonhole)', () => {
    // Constructed worst case: every nibble differs except the last.
    const a = '0000000000000000';
    const b = '1111111111111110'; // 15 set bits -> distance 15
    expect(hammingDistance(a, b)).toBe(15);
    const shared = hashBuckets(a).filter((x) => hashBuckets(b).includes(x));
    expect(shared).toEqual(['15:0']);
  });

  it('distance 16 with every nibble changed shares no bucket (boundary)', () => {
    const a = '0000000000000000';
    const b = '1111111111111111'; // 16 set bits -> distance 16
    expect(hammingDistance(a, b)).toBe(16);
    const shared = hashBuckets(a).filter((x) => hashBuckets(b).includes(x));
    expect(shared).toEqual([]);
  });

  it('holds for random pairs at distance <= 15', () => {
    const rand = () =>
      Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    for (let i = 0; i < 300; i++) {
      const a = rand();
      const b = rand();
      const d = hammingDistance(a, b);
      if (d <= 15) {
        const shared = hashBuckets(a).filter((x) => hashBuckets(b).includes(x));
        expect(shared.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── 3. Dihedral-group transformation classification ─────────────────────────

describe('SCRUM-30 transformation relationships', () => {
  it('same transform is identity ("identical")', () => {
    for (const t of TRANSFORMS) expect(relationshipOf(t, t)).toBe('identical');
  });

  it('rotations of plain classify as "rotation"', () => {
    expect(relationshipOf('plain', 'r90')).toBe('rotation');
    expect(relationshipOf('plain', 'r180')).toBe('rotation');
    expect(relationshipOf('plain', 'r270')).toBe('rotation');
    expect(relationshipOf('r90', 'r180')).toBe('rotation');
    expect(relationshipOf('r90', 'r270')).toBe('rotation');
  });

  it('reflections classify as "mirror"', () => {
    expect(relationshipOf('plain', 'mirror')).toBe('mirror');
    expect(relationshipOf('plain', 'vflip')).toBe('mirror');
    expect(relationshipOf('mirror', 'plain')).toBe('mirror');
    // rotation ∘ reflection is still a reflection
    expect(relationshipOf('r90', 'mirror')).toBe('mirror');
    expect(relationshipOf('vflip', 'r180')).toBe('mirror');
  });

  it('is symmetric in its outcome class', () => {
    for (const a of TRANSFORMS) {
      for (const b of TRANSFORMS) {
        expect(relationshipOf(a, b)).toBe(relationshipOf(b, a));
      }
    }
  });

  it('unknown labels normalize to plain', () => {
    expect(normalizeTransform('bogus')).toBe('plain');
    expect(normalizeTransform(undefined)).toBe('plain');
    expect(normalizeTransform(' MIRROR ')).toBe('plain'); // case/space not a known label
  });

  it('rotation matches get a wider band than identical matches', () => {
    const rot = relationshipThresholds('rotation');
    const id = relationshipThresholds('identical');
    expect(rot.block).toBe(DUPLICATE_CROSS_BLOCK_DISTANCE);
    expect(rot.review).toBe(DUPLICATE_CROSS_REVIEW_DISTANCE);
    expect(id.block).toBe(DUPLICATE_BLOCK_DISTANCE);
    expect(id.review).toBe(DUPLICATE_REVIEW_DISTANCE);
    expect(rot.block).toBeGreaterThanOrEqual(id.block);
    expect(rot.review).toBeGreaterThanOrEqual(id.review);
  });
});

// ── 4. Image-copy score banding ─────────────────────────────────────────────

describe('SCRUM-30 imageCopyScoreFromDistance', () => {
  const score = (d, rel) => imageCopyScoreFromDistance(d, relationshipThresholds(rel));

  it('maps the documented break points onto the score thresholds', () => {
    expect(score(0, 'identical')).toBe(1);
    expect(score(DUPLICATE_BLOCK_DISTANCE, 'identical')).toBeCloseTo(IMAGE_COPY_BLOCK_SCORE, 10);
    expect(score(DUPLICATE_REVIEW_DISTANCE, 'identical')).toBeCloseTo(IMAGE_COPY_REVIEW_SCORE, 10);
    expect(score(DUPLICATE_REVIEW_DISTANCE + 1, 'identical')).toBeLessThan(IMAGE_COPY_REVIEW_SCORE);
    expect(score(64, 'identical')).toBe(0);
  });

  it('applies the wider cross-transform break points for rotations', () => {
    expect(score(DUPLICATE_CROSS_BLOCK_DISTANCE, 'rotation')).toBeCloseTo(IMAGE_COPY_BLOCK_SCORE, 10);
    expect(score(DUPLICATE_CROSS_REVIEW_DISTANCE, 'rotation')).toBeCloseTo(
      IMAGE_COPY_REVIEW_SCORE,
      10
    );
  });

  it('is continuous and monotonically non-increasing over 0..64', () => {
    let prev = Infinity;
    for (let d = 0; d <= 64; d++) {
      const s = score(d, 'identical');
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
  });

  it('treats a non-finite distance as no evidence (0)', () => {
    expect(imageCopyScoreFromDistance(null)).toBe(0);
    expect(imageCopyScoreFromDistance(undefined)).toBe(0);
    expect(imageCopyScoreFromDistance(NaN)).toBe(0);
  });
});

// ── 5. Typed variant sets ───────────────────────────────────────────────────

describe('SCRUM-30 typed variant sets', () => {
  it('typedVariantsFromImages labels each orientation hash', () => {
    const variants = typedVariantsFromImages([fullImage()]);
    expect(variants).toEqual([
      { transform: 'plain', value: '0000000000000000' },
      { transform: 'mirror', value: '1111111111111111' },
      { transform: 'r90', value: '2222222222222222' },
      { transform: 'r180', value: '3333333333333333' },
      { transform: 'r270', value: '4444444444444444' },
      { transform: 'vflip', value: '5555555555555555' },
    ]);
  });

  it('prefers an explicit hashVariants list when present', () => {
    const variants = typedHashSetFromAnalysis({
      hashVariants: [
        { transform: 'mirror', value: 'aaaaaaaaaaaaaaaa' },
        { transform: 'plain', value: '' }, // dropped: empty value
      ],
      imageHashes: ['bbbbbbbbbbbbbbbb'], // ignored when variants exist
    });
    expect(variants).toEqual([{ transform: 'mirror', value: 'aaaaaaaaaaaaaaaa' }]);
  });

  it('falls back to the flat legacy hash lists', () => {
    const variants = typedHashSetFromAnalysis({
      imageHashes: ['0000000000000000', '1111111111111111'],
      rotationHashes: ['2222222222222222'],
      vflipHash: ['5555555555555555'],
    });
    expect(variants.map((v) => v.transform)).toEqual([
      'plain',
      'plain',
      'r90',
      'vflip',
    ]);
  });

  it('normalizeVariant keeps a known transform and nulls missing values', () => {
    expect(normalizeVariant('0000000000000000', 'mirror')).toEqual({
      transform: 'mirror',
      value: '0000000000000000',
    });
    expect(normalizeVariant(undefined, 'r90').value).toBeNull();
  });
});

// ── 6. Hash index + merge ───────────────────────────────────────────────────

describe('SCRUM-30 hash index + merge', () => {
  it('hashIndexFromVariants buckets every pHash and ignores sha256 entries', () => {
    const { hashVariants, hashBuckets: buckets } = hashIndexFromVariants([
      { transform: 'plain', value: '0000000000000000' },
      { transform: 'mirror', value: sha('b') },
    ]);
    expect(hashVariants).toHaveLength(2);
    expect(buckets).toHaveLength(16); // only the pHash contributes
    expect(buckets).toContain('0:0');
  });

  it('hashIndexFromAnalysis reuses stored variants for buckets', () => {
    const index = hashIndexFromAnalysis({
      hashVariants: [{ transform: 'plain', value: '000000000000000f' }],
    });
    expect(index.hashBuckets).toContain('15:f');
  });

  it('mergeVariants unions lists and de-duplicates by (transform, value)', () => {
    const merged = mergeVariants(
      [{ transform: 'plain', value: '0000000000000000' }],
      [
        { transform: 'plain', value: '0000000000000000' }, // dup
        { transform: 'mirror', value: '0000000000000000' }, // different transform
        { transform: 'plain', value: sha('a') },
      ]
    );
    expect(merged).toEqual([
      { transform: 'plain', value: '0000000000000000' },
      { transform: 'mirror', value: '0000000000000000' },
      { transform: 'plain', value: sha('a') },
    ]);
  });
});

// ── 7. Evidence fusion ──────────────────────────────────────────────────────

describe('SCRUM-30 fuseDuplicateEvidence', () => {
  it('corroborates on identity/provenance, repeat relist, or same seller + description', () => {
    expect(fuseDuplicateEvidence({ evidence: { identityOrProvenance: true } }).corroborated).toBe(true);
    expect(fuseDuplicateEvidence({ evidence: { repeatRelist: true } }).corroborated).toBe(true);
    expect(
      fuseDuplicateEvidence({ evidence: { sameSeller: true, sameDescription: true } }).corroborated
    ).toBe(true);
  });

  it('does NOT corroborate on visual/metadata context alone', () => {
    expect(fuseDuplicateEvidence({ evidence: { sameSeller: true } }).corroborated).toBe(false);
    expect(fuseDuplicateEvidence({ evidence: { sameDescription: true } }).corroborated).toBe(false);
    expect(fuseDuplicateEvidence({ evidence: { sameModel: true } }).corroborated).toBe(false);
    expect(fuseDuplicateEvidence({ evidence: { sameCategory: true } }).corroborated).toBe(false);
    expect(fuseDuplicateEvidence({}).corroborated).toBe(false);
  });

  it('clamps both scores into [0, 1]', () => {
    const fused = fuseDuplicateEvidence({ imageCopyScore: 1.5, physicalItemScore: -2 });
    expect(fused.imageCopyScore).toBe(1);
    expect(fused.physicalItemScore).toBe(0);
    expect(fuseDuplicateEvidence({ imageCopyScore: NaN }).imageCopyScore).toBe(0);
  });
});

// ── 8. Graded decisions ─────────────────────────────────────────────────────

describe('SCRUM-30 decideDuplicate', () => {
  it('BLOCKs standalone image-copy evidence at/above the block score', () => {
    expect(decideDuplicate({ imageCopyScore: 0.9 }).decision).toBe(DECISION.BLOCK);
    expect(decideDuplicate({ imageCopyScore: 1 }).decision).toBe(DECISION.BLOCK);
  });

  it('REVIEWs the image-copy band between block and review scores', () => {
    expect(decideDuplicate({ imageCopyScore: 0.89 }).decision).toBe(DECISION.REVIEW);
    expect(decideDuplicate({ imageCopyScore: 0.75 }).decision).toBe(DECISION.REVIEW);
  });

  it('ALLOWs below the review score', () => {
    expect(decideDuplicate({ imageCopyScore: 0.74 }).decision).toBe(DECISION.ALLOW);
    expect(decideDuplicate({}).decision).toBe(DECISION.ALLOW);
  });

  it('NEVER blocks on physical-item similarity alone (the core guarantee)', () => {
    const alone = decideDuplicate({ imageCopyScore: 0, physicalItemScore: 1 });
    expect(alone.decision).toBe(DECISION.REVIEW);
    expect(alone.corroborated).toBe(false);
    expect(alone.reasons.join(' ')).toMatch(/not proof/i);
  });

  it('BLOCKs a maximal physical-item match only when corroborated', () => {
    const corroborated = decideDuplicate({
      physicalItemScore: PHYSICAL_ITEM_BLOCK_SCORE,
      evidence: { identityOrProvenance: true },
    });
    expect(corroborated.decision).toBe(DECISION.BLOCK);
    expect(corroborated.corroborated).toBe(true);
  });

  it('keeps an explicit corroborated override', () => {
    const withOverride = decideDuplicate({ physicalItemScore: 0.99, corroborated: true });
    expect(withOverride.decision).toBe(DECISION.BLOCK);
  });

  it('REVIEWs a strong-but-uncorroborated physical-item match and ALLOWs weak ones', () => {
    expect(decideDuplicate({ physicalItemScore: 0.95 }).decision).toBe(DECISION.REVIEW);
    expect(decideDuplicate({ physicalItemScore: 0.5 }).decision).toBe(DECISION.ALLOW);
    // below the block score, even corroborated, cannot block on looks alone
    expect(
      decideDuplicate({ physicalItemScore: 0.95, evidence: { identityOrProvenance: true } }).decision
    ).toBe(DECISION.REVIEW);
  });
});

// ── 9. Candidate retrieval ──────────────────────────────────────────────────

describe('SCRUM-30 candidate retrieval', () => {
  const probeA = '0000000000000000';

  it('unions the indexed hits with the legacy fallback and reports the mode', async () => {
    const near = hashWithBits(2);
    const legacy = hashWithBits(4);
    const model = makeModel([
      mongoRow('indexed-1', [near], { buckets: true }),
      mongoRow('legacy-1', [legacy], { buckets: false }),
    ]);

    const result = await retrieveDuplicateCandidates({
      probeVariants: [{ transform: 'plain', value: probeA }],
      baseFilter: buildGateFilter({}),
      model,
    });

    const ids = result.candidates.map((c) => c._id).sort();
    expect(ids).toEqual(['indexed-1', 'legacy-1']);
    expect(result.mode).toBe('legacy-scan');
    expect(result.indexedHits).toBe(1);
    expect(result.uncovered).toBe(1);
  });

  it('reports "indexed" mode when every candidate carries buckets', async () => {
    const model = makeModel([mongoRow('indexed-1', [hashWithBits(3)], { buckets: true })]);
    const result = await retrieveDuplicateCandidates({
      probeVariants: [{ transform: 'plain', value: probeA }],
      baseFilter: buildGateFilter({}),
      model,
    });
    expect(result.mode).toBe('indexed');
    expect(result.uncovered).toBe(0);
  });

  it('excludes a bucketed candidate that shares no bucket (far away)', async () => {
    const model = makeModel([
      mongoRow('far', ['ffffffffffffffff'], { buckets: true }),
      mongoRow('near', [hashWithBits(2)], { buckets: true }),
    ]);
    const result = await retrieveDuplicateCandidates({
      probeVariants: [{ transform: 'plain', value: probeA }],
      baseFilter: buildGateFilter({}),
      model,
    });
    expect(result.candidates.map((c) => c._id)).toEqual(['near']);
  });

  it('skips documents with an empty imageHashes list', async () => {
    const model = makeModel([
      mongoRow('empty', [], { buckets: false }),
      mongoRow('full', [hashWithBits(1)], { buckets: false }),
    ]);
    const result = await retrieveDuplicateCandidates({
      probeVariants: [{ transform: 'plain', value: probeA }],
      baseFilter: buildGateFilter({}),
      model,
    });
    expect(result.candidates.map((c) => c._id)).toEqual(['full']);
  });
});

// ── 10. Gate decisions (indexed + legacy) ───────────────────────────────────

describe('SCRUM-30 evaluateDuplicateGate', () => {
  const gate = async (probeHash, candidateHash, opts = {}) => {
    const model = makeModel([mongoRow('c1', [candidateHash], { buckets: false, ...opts })]);
    const { results, retrieval } = await evaluateDuplicateGate({
      probeSets: [typedVariantsFromImages([{ hash: probeHash }])],
      model,
    });
    return { ...results[0], retrieval };
  };

  it('BLOCKs an exact copy (distance 0)', async () => {
    const r = await gate('0000000000000000', '0000000000000000');
    expect(r.decision).toBe(DECISION.BLOCK);
    expect(r.best.distance).toBe(0);
  });

  it('BLOCKs at the block-distance boundary and REVIEWs just past it', async () => {
    const atBlock = await gate('0000000000000000', hashWithBits(DUPLICATE_BLOCK_DISTANCE));
    expect(atBlock.best.distance).toBe(DUPLICATE_BLOCK_DISTANCE);
    expect(atBlock.decision).toBe(DECISION.BLOCK);

    const pastBlock = await gate('0000000000000000', hashWithBits(DUPLICATE_BLOCK_DISTANCE + 4));
    expect(pastBlock.decision).toBe(DECISION.REVIEW);
  });

  it('REVIEWs the review-band boundary', async () => {
    const r = await gate('0000000000000000', hashWithBits(DUPLICATE_REVIEW_DISTANCE));
    expect(r.best.distance).toBe(DUPLICATE_REVIEW_DISTANCE);
    expect(r.decision).toBe(DECISION.REVIEW);
  });

  it('ALLOWs a genuinely different image', async () => {
    const r = await gate('0000000000000000', '0000000000ffffff'); // distance 24
    expect(r.best.distance).toBe(24);
    expect(r.decision).toBe(DECISION.ALLOW);
  });

  it('classifies and BLOCKs a mirrored upload via the mirror variant', async () => {
    // Candidate stores only the plain hash; probe carries plain + mirror.
    const plain = '0000000000000000';
    const mirrored = '1111111111111111';
    const model = makeModel([mongoRow('c1', [plain], { buckets: false })]);
    const { results } = await evaluateDuplicateGate({
      probeSets: [
        typedVariantsFromImages([
          { hash: mirrored, mirrorHash: plain },
        ]),
      ],
      model,
    });
    expect(results[0].best.relationship).toBe('mirror');
    expect(results[0].decision).toBe(DECISION.BLOCK);
  });

  it('returns one graded result per probe set', async () => {
    const model = makeModel([mongoRow('c1', ['0000000000000000'], { buckets: false })]);
    const { results } = await evaluateDuplicateGate({
      probeSets: [
        typedVariantsFromImages([{ hash: '0000000000000000' }]),
        typedVariantsFromImages([{ hash: 'ffffffffffffffff' }]),
      ],
      model,
    });
    expect(results).toHaveLength(2);
    expect(results[0].decision).toBe(DECISION.BLOCK);
    expect(results[1].decision).toBe(DECISION.ALLOW);
    // The far probe still reports its closest (but useless) candidate at
    // distance 64 — the gate scores that as no evidence.
    expect(results[1].best.distance).toBe(64);
    expect(results[1].imageCopyScore).toBe(0);
  });

  it('never matches a non-pHash probe (no indexed buckets requested)', async () => {
    const model = makeModel([mongoRow('c1', ['0000000000000000'], { buckets: false })]);
    const { results } = await evaluateDuplicateGate({
      probeSets: [typedVariantsFromImages([{ hash: sha('a') }])],
      model,
    });
    expect(results[0].best).toBeNull();
    expect(results[0].decision).toBe(DECISION.ALLOW);
  });
});

describe('SCRUM-30 buildGateFilter', () => {
  it('scopes to active/sold, excludes the edited listing and requires hashes', () => {
    const filter = buildGateFilter({ excludeProductId: 'abc', categories: ['c1', 'c2'] });
    expect(filter.status).toEqual({ $in: ['active', 'sold'] });
    expect(filter._id).toEqual({ $ne: 'abc' });
    expect(filter.category).toEqual({ $in: ['c1', 'c2'] });
    expect(filter['aiAnalysis.imageHashes']).toEqual({ $exists: true, $ne: [] });
  });

  it('uses a scalar category for a single category', () => {
    expect(buildGateFilter({ categories: ['c1'] }).category).toBe('c1');
    expect(buildGateFilter({}).category).toBeUndefined();
  });
});
