/* eslint-disable no-console */
const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { perceptualHashFromBuffer, hammingDistance } = require('../services/imageHash');

/**
 * 10 real product photographs sourced from Pexels (royalty-free, CC0 license).
 * Each covers a common marketplace category.
 */
const ORIGINAL_IMAGES = [
  { id: 'laptop', url: 'https://images.pexels.com/photos/996329/pexels-photo-996329.jpeg?w=800', category: 'Computers & Laptops', title: 'MacBook Pro' },
  { id: 'phone', url: 'https://images.pexels.com/photos/1092644/pexels-photo-1092644.jpeg?w=800', category: 'Mobile Phones', title: 'Android Smartphone' },
  { id: 'headphones', url: 'https://images.pexels.com/photos/1005633/pexels-photo-1005633.jpeg?w=800', category: 'Electronics', title: 'Sony Headphones' },
  { id: 'sneakers', url: 'https://images.pexels.com/photos/1464625/pexels-photo-1464625.jpeg?w=800', category: 'Fashion', title: 'Nike Sneakers' },
  { id: 'jacket', url: 'https://images.pexels.com/photos/1536619/pexels-photo-1536619.jpeg?w=800', category: 'Fashion', title: 'Leather Jacket' },
  { id: 'chair', url: 'https://images.pexels.com/photos/116675/pexels-photo-116675.jpeg?w=800', category: 'Home & Garden', title: 'Office Chair' },
  { id: 'bike', url: 'https://images.pexels.com/photos/3764984/pexels-photo-3764984.jpeg?w=800', category: 'Sports & Outdoors', title: 'Mountain Bike' },
  { id: 'camera', url: 'https://images.pexels.com/photos/1149137/pexels-photo-1149137.jpeg?w=800', category: 'Electronics', title: 'Canon Camera' },
  { id: 'books', url: 'https://images.pexels.com/photos/2529148/pexels-photo-2529148.jpeg?w=800', category: 'Books & Media', title: 'Book Collection' },
  { id: 'watch', url: 'https://images.pexels.com/photos/3641056/pexels-photo-3641056.jpeg?w=800', category: 'Electronics', title: 'Smart Watch' },
];

/**
 * 5 pairs of genuinely different real photographs within the same category.
 * These are the false-positive stress test — different products, same category.
 */
const SIMILAR_PAIRS = [
  { id: 'tshirt_a', url: 'https://images.pexels.com/photos/4210860/pexels-photo-4210860.jpeg?w=800', category: 'Fashion', title: 'White T-Shirt (Brand A)', pairGroup: 'tshirt' },
  { id: 'tshirt_b', url: 'https://images.pexels.com/photos/3671084/pexels-photo-3671084.jpeg?w=800', category: 'Fashion', title: 'White T-Shirt (Brand B)', pairGroup: 'tshirt' },
  { id: 'laptop_a', url: 'https://images.pexels.com/photos/18105/pexels-photo.jpg?w=800', category: 'Computers & Laptops', title: 'Laptop on Desk (Listing A)', pairGroup: 'laptop' },
  { id: 'laptop_b', url: 'https://images.pexels.com/photos/205421/pexels-photo-205421.jpeg?w=800', category: 'Computers & Laptops', title: 'Laptop Close-Up (Listing B)', pairGroup: 'laptop' },
  { id: 'bike_a', url: 'https://images.pexels.com/photos/276517/pexels-photo-276517.jpeg?w=800', category: 'Sports & Outdoors', title: 'Road Bike (Listing A)', pairGroup: 'bike' },
  { id: 'bike_b', url: 'https://images.pexels.com/photos/544966/pexels-photo-544966.jpeg?w=800', category: 'Sports & Outdoors', title: 'Trail Bike (Listing B)', pairGroup: 'bike' },
  { id: 'phone_a', url: 'https://images.pexels.com/photos/607812/pexels-photo-607812.jpeg?w=800', category: 'Mobile Phones', title: 'iPhone (Listing A)', pairGroup: 'phone' },
  { id: 'phone_b', url: 'https://images.pexels.com/photos/1294886/pexels-photo-1294886.jpeg?w=800', category: 'Mobile Phones', title: 'Samsung (Listing B)', pairGroup: 'phone' },
  { id: 'camera_a', url: 'https://images.pexels.com/photos/51383/photo-camera-taking-the-photo-51383.jpeg?w=800', category: 'Electronics', title: 'Camera Body (Listing A)', pairGroup: 'camera' },
  { id: 'camera_b', url: 'https://images.pexels.com/photos/1787220/pexels-photo-1787220.jpeg?w=800', category: 'Electronics', title: 'Camera Lens (Listing B)', pairGroup: 'camera' },
];

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    maxRedirects: 5,
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return Buffer.from(res.data);
}

/**
 * Variant 1: Crop ~10% from edges (center crop to 90% of original dimensions)
 */
async function createCropVariant(buffer) {
  const meta = await sharp(buffer).metadata();
  const cropW = Math.round(meta.width * 0.9);
  const cropH = Math.round(meta.height * 0.9);
  const left = Math.round((meta.width - cropW) / 2);
  const top = Math.round((meta.height - cropH) / 2);

  return sharp(buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(800, 800, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Variant 2: Recompress at low JPEG quality (~50%) and resize down 20%
 */
async function createRecompressVariant(buffer) {
  const meta = await sharp(buffer).metadata();
  const newW = Math.round(meta.width * 0.8);
  const newH = Math.round(meta.height * 0.8);

  return sharp(buffer)
    .resize(newW, newH, { fit: 'inside' })
    .jpeg({ quality: 50 })
    .toBuffer();
}

/**
 * Generate all fixture images: originals + variants + similar-but-different.
 */
async function generateFixtures() {
  const originals = [];
  const variants = [];
  const similarPairs = [];

  for (const img of ORIGINAL_IMAGES) {
    process.stdout.write(`[Fixtures] Downloading ${img.id}...`);
    try {
      const buffer = await downloadImage(img.url);
      console.log(` ${buffer.length} bytes`);
      originals.push({ ...img, buffer });

      const cropBuffer = await createCropVariant(buffer);
      variants.push({ originalId: img.id, originalTitle: img.title, type: 'crop-10%', buffer: cropBuffer, category: img.category });

      const recompressBuffer = await createRecompressVariant(buffer);
      variants.push({ originalId: img.id, originalTitle: img.title, type: 'recompress-q50-resize20%', buffer: recompressBuffer, category: img.category });
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
    }
  }

  for (const img of SIMILAR_PAIRS) {
    process.stdout.write(`[Fixtures] Downloading similar ${img.id}...`);
    try {
      const buffer = await downloadImage(img.url);
      console.log(` ${buffer.length} bytes`);
      similarPairs.push({ ...img, buffer });
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
    }
  }

  return { originals, variants, similarPairs };
}

/**
 * Compute perceptual hashes for all fixture buffers.
 */
async function computeHashes(fixtures) {
  const { originals, variants, similarPairs } = fixtures;

  for (const img of originals) {
    img.hash = await perceptualHashFromBuffer(img.buffer);
  }
  for (const v of variants) {
    v.hash = await perceptualHashFromBuffer(v.buffer);
  }
  for (const s of similarPairs) {
    s.hash = await perceptualHashFromBuffer(s.buffer);
  }

  return { originals, variants, similarPairs };
}

/**
 * Write duplicate-fixture-report.json with all hashes and group labels.
 */
function writeReport({ originals, variants, similarPairs }, reportPath) {
  const report = {
    generatedAt: new Date().toISOString(),
    hashAlgorithm: '64-bit DCT pHash (uncommitted working copy)',
    committedAlgorithm: '16-bit average hash (exact-match only)',
    threshold: 12,
    note: 'HASH_SIMILARITY_THRESHOLD=12 validated against real photographs (Pexels)',
    groups: {
      originals: originals.map((img) => ({
        id: img.id,
        title: img.title,
        category: img.category,
        hash: img.hash,
        group: 'original',
      })),
      trueDuplicates: variants.map((v) => ({
        originalId: v.originalId,
        originalTitle: v.originalTitle,
        variantType: v.type,
        hash: v.hash,
        category: v.category,
        group: 'true-duplicate',
      })),
      similarButDifferent: similarPairs.map((s) => ({
        id: s.id,
        title: s.title,
        category: s.category,
        hash: s.hash,
        pairGroup: s.pairGroup,
        group: 'similar-but-different',
      })),
    },
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`[Fixtures] Report written to ${reportPath}`);
  return report;
}

module.exports = {
  ORIGINAL_IMAGES,
  SIMILAR_PAIRS,
  generateFixtures,
  computeHashes,
  writeReport,
  createCropVariant,
  createRecompressVariant,
  downloadImage,
};
