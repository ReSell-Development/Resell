/**
 * SCRUM-30 — Duplicate detection metrics.
 *
 * Builds a small labeled dataset of synthetic product photos (positives =
 * transforms of the same source image that should be flagged; negatives =
 * genuinely different listings, including same-model-different-photo) and
 * reports precision / recall / false-positive-rate plus matching latency.
 *
 * Assertions are deliberately loose (the dataset is small) — the point is to
 * prove the pipeline is in a sane operating region and to make the numbers
 * visible in CI output, not to pin exact thresholds.
 */

const sharp = require('sharp');
const {
  perceptualHashFromBuffer,
  mirrorPerceptualHashFromBuffer,
  orientationHashesFromBuffer,
} = require('../services/imageHash');
const {
  typedVariantsFromImages,
  bestHashMatch,
  imageCopyScoreFromDistance,
  relationshipThresholds,
  decideDuplicate,
} = require('../services/duplicatePipeline');

jest.setTimeout(120000);

// ── image generation (shared shape with the transform-robustness suite) ─────

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

const overBackground = (fill) =>
  sharp(canvas(fill))
    .composite([{ input: objectSvg(), blend: 'over' }])
    .png()
    .toBuffer();

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

const fullSet = async (buf) => {
  const hash = await perceptualHashFromBuffer(buf);
  const mirrorHash = await mirrorPerceptualHashFromBuffer(buf);
  const { rotationHashes, vflipHash } = await orientationHashesFromBuffer(buf);
  return { hash, mirrorHash, rotationHashes, vflipHash };
};

const variantsFor = async (buf) => typedVariantsFromImages([await fullSet(buf)]);

/** Match a probe against a corpus of stored listings → graded decision. */
const detect = (probeVariants, corpus) => {
  const best = bestHashMatch(probeVariants, corpus);
  const imageCopyScore = best
    ? imageCopyScoreFromDistance(best.distance, relationshipThresholds(best.relationship))
    : 0;
  const { decision } = decideDuplicate({ imageCopyScore });
  // "predicted duplicate" = anything the pipeline does not allow through.
  return { predictedPositive: decision !== 'ALLOW', decision, best };
};

describe('SCRUM-30 duplicate detection metrics', () => {
  // Corpus: the source listing plus genuinely different listings. The source
  // image is the only positive anchor — everything else is a distractor.
  let corpus; // array of { _id, aiAnalysis: { hashVariants } }
  let positives; // probe variant lists expected to be flagged
  let negatives; // probe variant lists expected to be allowed

  beforeAll(async () => {
    const source = await overBackground('#ffffff');

    const corpusBuffers = [
      source, // index 0 — the positive anchor
      await otherImage(0),
      await otherImage(1),
      await sameModelImage(0),
    ];
    corpus = [];
    for (let i = 0; i < corpusBuffers.length; i++) {
      corpus.push({
        _id: `corpus-${i}`,
        title: `corpus listing ${i}`,
        seller: `seller-${i}`,
        aiAnalysis: { hashVariants: await variantsFor(corpusBuffers[i]) },
      });
    }

    const positiveKinds = [
      'copy',
      'jpeg',
      'crop',
      'rotate90',
      'mirror',
      'vflip',
      'bgdark',
      'bgphoto',
      'brightness',
    ];
    positives = [];
    for (const kind of positiveKinds) {
      positives.push({ kind, variants: await variantsFor(await transform(source, kind)) });
    }

    // Negative probes are images NOT in the corpus, so no self-match.
    negatives = [];
    for (const seed of [5, 6]) {
      negatives.push({ kind: `other-${seed}`, variants: await variantsFor(await otherImage(seed)) });
    }
    for (const seed of [5, 6]) {
      negatives.push({
        kind: `sameModel-${seed}`,
        variants: await variantsFor(await sameModelImage(seed)),
      });
    }
  });

  const evaluate = () => {
    let tp = 0;
    let fn = 0;
    let fp = 0;
    let tn = 0;
    const missed = [];
    const falseAlarms = [];

    for (const p of positives) {
      const r = detect(p.variants, corpus);
      if (r.predictedPositive) tp++;
      else {
        fn++;
        missed.push(`${p.kind}(${r.best ? `${r.best.distance}d` : 'no-match'})`);
      }
    }
    for (const n of negatives) {
      const r = detect(n.variants, corpus);
      if (r.predictedPositive) {
        fp++;
        falseAlarms.push(`${n.kind}(${r.best ? `${r.best.distance}d/${r.best.relationship}` : 'no-match'})`);
      } else tn++;
    }

    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    const fpr = fp + tn === 0 ? 0 : fp / (fp + tn);
    return { tp, fn, fp, tn, precision, recall, fpr, missed, falseAlarms };
  };

  it('flags every transformed copy without false-flagging distinct listings', () => {
    const m = evaluate();
    // eslint-disable-next-line no-console
    console.log(
      `[SCRUM-30 metrics] precision=${m.precision.toFixed(3)} recall=${m.recall.toFixed(3)} ` +
        `FPR=${m.fpr.toFixed(3)} | tp=${m.tp} fn=${m.fn} fp=${m.fp} tn=${m.tn}` +
        (m.missed.length ? ` | missed: ${m.missed.join(', ')}` : '') +
        (m.falseAlarms.length ? ` | false alarms: ${m.falseAlarms.join(', ')}` : '')
    );

    expect(m.recall).toBeGreaterThanOrEqual(0.8);
    expect(m.precision).toBeGreaterThanOrEqual(0.9);
    expect(m.fpr).toBeLessThanOrEqual(0.1);
  });

  it('blocks a clear image copy and allows a distinct listing (per-decision sanity)', () => {
    const copy = detect(positives.find((p) => p.kind === 'copy').variants, corpus);
    expect(copy.decision).toBe('BLOCK');

    const distinct = detect(negatives.find((n) => n.kind === 'other-5').variants, corpus);
    expect(distinct.decision).toBe('ALLOW');
  });

  it('keeps matching latency bounded', () => {
    const candidateVariants = corpus[0].aiAnalysis.hashVariants;
    const probeVariants = positives[0].variants;
    const iterations = 500;

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      const best = bestHashMatch(probeVariants, corpus);
      const score = best
        ? imageCopyScoreFromDistance(best.distance, relationshipThresholds(best.relationship))
        : 0;
      decideDuplicate({ imageCopyScore: score });
    }
    const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
    const avgMs = totalMs / iterations;

    // eslint-disable-next-line no-console
    console.log(
      `[SCRUM-30 metrics] match latency: ${avgMs.toFixed(3)} ms/comparison ` +
        `(${iterations} iterations, ${candidateVariants.length} candidate variants)`
    );

    // Generous bound — pure hamming math is sub-millisecond; this only guards
    // against gross regressions (e.g. accidental O(n^2) image work).
    expect(avgMs).toBeLessThan(25);
  });
});
