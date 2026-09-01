const crypto = require('crypto');

/**
 * Perceptual hash generator using a simple DCT-inspired approach.
 * Since we don't have opencv, we use a deterministic image hash based on
 * the average color blocks. This provides reasonable duplicate detection
 * for visually similar images.
 *
 * For images without sharp/imagemagick available, we use a content-based
 * SHA hash fallback that still detects exact duplicates.
 */

const BLOCK_SIZE = 8;

const perceptualHashFromBuffer = async (imageBuffer) => {
  try {
    // Try using sharp if available, otherwise fall back to content hash
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      sharp = null;
    }

    if (sharp) {
      // Resize to 32x32 grayscale, then compute average hash
      const { data, info } = await sharp(imageBuffer)
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const blockSize = BLOCK_SIZE;
      const blocks = [];
      for (let by = 0; by < 32; by += blockSize) {
        for (let bx = 0; bx < 32; bx += blockSize) {
          let sum = 0;
          for (let y = 0; y < blockSize; y++) {
            for (let x = 0; x < blockSize; x++) {
              sum += data[(by + y) * 32 + (bx + x)];
            }
          }
          blocks.push(sum / (blockSize * blockSize));
        }
      }

      // Convert to binary hash: each block above median = 1
      const sorted = [...blocks].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const hashBits = blocks.map((v) => (v >= median ? 1 : 0)).join('');
      const hash = parseInt(hashBits, 2).toString(16).padStart(16, '0');
      return hash;
    }

    // Fallback: SHA-256 of content
    return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  } catch (err) {
    // Last resort
    return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  }
};

const hammingDistance = (hash1, hash2) => {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64;
  let distance = 0;
  // Convert hex strings to binary and compare bits
  const bin1 = BigInt('0x' + hash1).toString(2).padStart(64, '0');
  const bin2 = BigInt('0x' + hash2).toString(2).padStart(64, '0');
  for (let i = 0; i < bin1.length; i++) {
    if (bin1[i] !== bin2[i]) distance++;
  }
  return distance;
};

const similarity = (hash1, hash2) => {
  const distance = hammingDistance(hash1, hash2);
  return Math.max(0, 1 - distance / 64);
};

module.exports = {
  perceptualHashFromBuffer,
  hammingDistance,
  similarity,
};
