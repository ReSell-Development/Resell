/**
 * SCRUM-30 — Transformation robustness of duplicate detection.
 *
 * Runs the real sharp pHash pipeline (perceptualHashFromBuffer + orientationHashes
 * + the duplicate pipeline's matching) over a synthetic product photo and its
 * transformed variants. Locks in which transformations are treated as an image
 * copy (BLOCK), which are still detected but only REVIEW, and which must be
 * allowed (genuinely different items — including the same model).
 *
 * No DB / server boot: only the hashing service and the pure pipeline.
 */

const sharp = require('sharp');
const {
  perceptualHashFromBuffer,
  mirrorPerceptualHashFromBuffer,
  orientationHashesFromBuffer,
  hammingDistance,
} = require('../services/imageHash');
const {
  typedVariantsFromImages,
  compareHashSets,
  imageCopyScoreFromDistance,
  relationshipThresholds,
  decideDuplicate,
  DUPLICATE_BLOCK_DISTANCE,
  DUPLICATE_CROSS_BLOCK_DISTANCE,
  DUPLICATE_REVIEW_DISTANCE,
} = require('../services/duplicatePipeline');

jest.setTimeout(120000);

// ── synthetic images ────────────────────────────────────────────────────────
// The object is drawn on a transparent SVG canvas so it can be composited over
// different backgrounds while keeping the object pixels byte-identical.

const svg = (w, h, body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

const objectSvg = () =>
  svg(
    300,
    300,
    `
      <rect x="60" y="80" width="180" height="140" rx="12" fill="#1b4f9c"/>
      <circle cx="150" cy="150" r="40" fill="#e0a020"/>
      <rect x="90" y="100" width="40" height="30" fill="#b03030"/>
    `
  );

const canvas = (fill) => svg(300, 300, `<rect width="300" height="300" fill="${fill}"/>`);

/** Composite the object over a background colour. */
const overBackground = (fill) =>
  sharp(canvas(fill))
    .composite([{ input: objectSvg(), blend: 'over' }])
    .png()
    .toBuffer();

const base = () => overBackground('#ffffff');

/** A genuinely different product photo. */
const otherImage = (seed = 0) =>
  sharp(
    svg(
      300,
      300,
      `
        <rect width="300" height="300" fill="#101010"/>
        <ellipse cx="${60 + seed * 20}" cy="220" rx="50" ry="30" fill="#7f7f7f"/>
        <rect x="${180 + seed * 10}" y="20" width="60" height="200" fill="#404040"/>
      `
    )
  )
    .png()
    .toBuffer();

/**
 * "Same model, different photo": shares the object's palette but a completely
 * different layout / composition — a normal relisting by another seller.
 */
const sameModelImage = (seed = 0) =>
  sharp(
    svg(
      300,
      300,
      `
        <rect width="300" height="300" fill="#f2f2f2"/>
        <rect x="${150 - seed * 15}" y="150" width="100" height="100" fill="#1b4f9c"/>
        <circle cx="${80 + seed * 20}" cy="200" r="30" fill="#e0a020"/>
      `
    )
  )
    .png()
    .toBuffer();

/** The full stored hash set (plain + mirror + r90..r270 + vflip). */
const fullSet = async (buf) => {
  const hash = await perceptualHashFromBuffer(buf);
  const mirrorHash = await mirrorPerceptualHashFromBuffer(buf);
  const { rotationHashes, vflipHash } = await orientationHashesFromBuffer(buf);
  return { hash, mirrorHash, rotationHashes, vflipHash };
};

const variantsFor = async (buf) => typedVariantsFromImages([await fullSet(buf)]);

/** Gate math for a probe against a candidate's stored variant set. */
const gate = (probeVariants, candidateVariants) => {
  const best = compareHashSets(probeVariants, candidateVariants);
  const imageCopyScore = best
    ? imageCopyScoreFromDistance(best.distance, relationshipThresholds(best.relationship))
    : 0;
  const decision = decideDuplicate({ imageCopyScore });
  return { best, imageCopyScore, decision: decision.decision };
};

const transform = async (buf, kind) => {
  switch (kind) {
    case 'copy':
      return buf;
    case 'jpeg':
      return sharp(buf).jpeg({ quality: 30 }).toBuffer();
    case 'crop':
      return sharp(buf)
        .extract({ left: 20, top: 20, width: 260, height: 260 })
        .resize(300, 300)
        .png()
        .toBuffer();
    case 'rotate90':
      return sharp(buf).rotate(90).png().toBuffer();
    case 'rotate180':
      return sharp(buf).rotate(180).png().toBuffer();
    case 'rotate270':
      return sharp(buf).rotate(270).png().toBuffer();
    case 'mirror':
      return sharp(buf).flop().png().toBuffer();
    case 'vflip':
      return sharp(buf).flip().png().toBuffer();
    case 'bgdark':
      return overBackground('#101020');
    case 'bgphoto':
      return overBackground('#3a2f1a');
    case 'brightness':
      return sharp(buf).modulate({ brightness: 1.25 }).png().toBuffer();
    default:
      return buf;
  }
};

describe('SCRUM-30 transformation robustness (real sharp pHash)', () => {
  let candidateVariants;
  let baseBuffer;

  beforeAll(async () => {
    baseBuffer = await base();
    candidateVariants = await variantsFor(baseBuffer);
  });

  describe('image copies must BLOCK', () => {
    it.each([
      ['copy', 0, 'identical'],
      ['jpeg', null, 'identical'],
      ['rotate90', null, 'rotation'],
      ['rotate180', null, 'rotation'],
      ['rotate270', null, 'rotation'],
      ['mirror', null, 'mirror'],
      ['vflip', null, 'mirror'],
    ])('%s -> BLOCK (%s)', async (kind, expectedDistance, expectedRelationship) => {
      const probe = await variantsFor(await transform(baseBuffer, kind));
      const { best, decision } = gate(probe, candidateVariants);
      expect(best).not.toBeNull();
      expect(best.relationship).toBe(expectedRelationship);
      if (expectedDistance !== null) expect(best.distance).toBe(expectedDistance);
      expect(decision).toBe('BLOCK');
    });
  });

  describe('transformed duplicates must be detected (BLOCK or REVIEW), never missed', () => {
    it.each(['crop', 'bgdark', 'bgphoto', 'brightness'])('%s is detected', async (kind) => {
      const probe = await variantsFor(await transform(baseBuffer, kind));
      const { best, decision } = gate(probe, candidateVariants);
      expect(decision).not.toBe('ALLOW');
      expect(best.distance).toBeLessThanOrEqual(DUPLICATE_REVIEW_DISTANCE);
    });

    it('a mild crop lands in the REVIEW band, not a false BLOCK (documented trade-off)', async () => {
      const probe = await variantsFor(await transform(baseBuffer, 'crop'));
      const { best, decision } = gate(probe, candidateVariants);
      expect(best.distance).toBeGreaterThan(DUPLICATE_BLOCK_DISTANCE);
      expect(decision).toBe('REVIEW');
    });
  });

  describe('genuinely different listings must ALLOW', () => {
    it('a different product photo is allowed', async () => {
      const probe = await variantsFor(await otherImage(0));
      const { best, decision } = gate(probe, candidateVariants);
      expect(decision).toBe('ALLOW');
      expect(best.distance).toBeGreaterThan(DUPLICATE_REVIEW_DISTANCE);
    });

    it('the same model photographed differently is allowed (never block on looks)', async () => {
      const probe = await variantsFor(await sameModelImage(0));
      const { best, decision } = gate(probe, candidateVariants);
      expect(decision).toBe('ALLOW');
      expect(best.distance).toBeGreaterThan(DUPLICATE_REVIEW_DISTANCE);
    });

    it('several distinct items are all allowed', async () => {
      for (const seed of [1, 2, 3]) {
        const probe = await variantsFor(await otherImage(seed));
        expect(gate(probe, candidateVariants).decision).toBe('ALLOW');
        const model = await variantsFor(await sameModelImage(seed));
        expect(gate(model, candidateVariants).decision).toBe('ALLOW');
      }
    });
  });

  describe('transformation coverage is what makes rotations catchable', () => {
    it('a rotated copy would evade a plain-only pHash comparison', async () => {
      const rotated = await transform(baseBuffer, 'rotate90');
      const plainOnlyDistance = hammingDistance(
        await perceptualHashFromBuffer(baseBuffer),
        await perceptualHashFromBuffer(rotated)
      );
      // Plain-vs-plain is far outside any duplicate band — the rotation variant
      // is what recovers the match.
      expect(plainOnlyDistance).toBeGreaterThan(DUPLICATE_REVIEW_DISTANCE);

      const probe = await variantsFor(rotated);
      const { best, decision } = gate(probe, candidateVariants);
      expect(best.relationship).toBe('rotation');
      expect(decision).toBe('BLOCK');
    });

    it('a mirrored copy would evade a plain-only pHash comparison', async () => {
      const mirrored = await transform(baseBuffer, 'mirror');
      const plainOnlyDistance = hammingDistance(
        await perceptualHashFromBuffer(baseBuffer),
        await perceptualHashFromBuffer(mirrored)
      );
      expect(plainOnlyDistance).toBeGreaterThan(DUPLICATE_REVIEW_DISTANCE);

      const probe = await variantsFor(mirrored);
      const { best, decision } = gate(probe, candidateVariants);
      expect(best.relationship).toBe('mirror');
      expect(decision).toBe('BLOCK');
    });
  });

  describe('stock-photo reuse / relisting', () => {
    it('re-uploading the identical image (relisting/stock reuse) BLOCKs', async () => {
      // Re-run the hasher on independent buffers of the same picture.
      const stockA = await overBackground('#ffffff');
      const stockB = await overBackground('#ffffff');
      const probe = await variantsFor(stockB);
      const candidate = await variantsFor(stockA);
      const { best, decision } = gate(probe, candidate);
      expect(best.distance).toBe(0);
      expect(decision).toBe('BLOCK');
    });

    it('the cross-transform block distance is a documented, bounded band', () => {
      expect(DUPLICATE_CROSS_BLOCK_DISTANCE).toBeGreaterThanOrEqual(DUPLICATE_BLOCK_DISTANCE);
    });
  });
});
