#!/usr/bin/env node

/**
 * Print the stored visual-similarity evidence for two listings.
 *
 * Usage: node scripts/measure_similarity.js <productIdA> <productIdB>
 *
 * This is intentionally diagnostic-only: it never writes to MongoDB and makes
 * no judgement about whether either listing is a duplicate.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const { hammingDistance } = require('../src/services/imageHash');
const { cosineSimilarity } = require('../src/services/productFingerprint');

const allHashes = (product) => [
  ...(product?.aiAnalysis?.imageHashes || []),
  ...(product?.aiAnalysis?.rotationHashes || []),
  ...(product?.aiAnalysis?.vflipHash || []),
].filter(Boolean);

const minHamming = (a, b) => {
  let best = null;
  for (const left of allHashes(a)) {
    for (const right of allHashes(b)) {
      const distance = hammingDistance(left, right);
      if (distance !== null && (best === null || distance < best)) best = distance;
    }
  }
  return best;
};

const bestCosine = (left, right) => {
  let best = null;
  for (const a of left) {
    for (const b of right) {
      const score = cosineSimilarity(a, b);
      if (score !== null && (best === null || score > best)) best = score;
    }
  }
  return best;
};

const wholeImageVectors = (product) => [
  ...(Array.isArray(product?.embedding) && product.embedding.length ? [product.embedding] : []),
  ...(product?.images || []).map((image) => image.cnnFeatures).filter((v) => Array.isArray(v) && v.length),
];

const cropVectors = (product, key) => (product?.aiAnalysis?.detectedObjects || [])
  .map((object) => object?.[key])
  .filter((v) => Array.isArray(v) && v.length);

const display = (value) => (value === null ? 'unavailable' : Number(value).toFixed(6));

async function main() {
  const [leftId, rightId] = process.argv.slice(2);
  if (!leftId || !rightId) {
    throw new Error('Usage: node scripts/measure_similarity.js <productIdA> <productIdB>');
  }
  if (!mongoose.isValidObjectId(leftId) || !mongoose.isValidObjectId(rightId)) {
    throw new Error('Both arguments must be valid MongoDB ObjectIds');
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) is required');
  await mongoose.connect(uri);

  const [left, right] = await Promise.all([
    Product.findById(leftId).lean(),
    Product.findById(rightId).lean(),
  ]);
  if (!left || !right) throw new Error(`Listing not found: ${!left ? leftId : rightId}`);

  const cnnWhole = bestCosine(
    (left.images || []).map((image) => image.cnnFeatures).filter((v) => Array.isArray(v) && v.length),
    (right.images || []).map((image) => image.cnnFeatures).filter((v) => Array.isArray(v) && v.length)
  );
  const clipWhole = bestCosine(
    Array.isArray(left.embedding) && left.embedding.length ? [left.embedding] : [],
    Array.isArray(right.embedding) && right.embedding.length ? [right.embedding] : []
  );

  console.log(`A: ${left._id} — ${left.title}`);
  console.log(`B: ${right._id} — ${right.title}`);
  console.log(`pHash 6-hash min Hamming distance: ${minHamming(left, right) ?? 'unavailable'}`);
  console.log(`CNN whole-image cosine: ${display(cnnWhole)}`);
  console.log(`CNN primary/object-crop cosine: ${display(bestCosine(cropVectors(left, 'cropEmbedding'), cropVectors(right, 'cropEmbedding')))}`);
  console.log(`CLIP whole-image cosine: ${display(clipWhole)}`);
  console.log(`CLIP object-crop cosine: ${display(bestCosine(cropVectors(left, 'clipCropEmbedding'), cropVectors(right, 'clipCropEmbedding')))}`);
}

main()
  .catch((error) => {
    console.error(`[measure_similarity] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

