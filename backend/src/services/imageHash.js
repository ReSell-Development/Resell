const crypto = require('crypto');

/**
 * 64-bit perceptual hash (pHash) using DCT (Discrete Cosine Transform).
 *
 * Algorithm:
 *   1. Resize to 32×32 grayscale
 *   2. Compute 2D DCT
 *   3. Take the top-left 8×8 block (lowest frequencies)
 *   4. Compute median of the 64 DCT coefficients
 *   5. Each bit = 1 if coefficient >= median, else 0
 *
 * This produces a 64-bit hash that is robust to:
 *   - Cropping, resizing, recompression
 *   - Minor color/brightness shifts
 *   - Different product photos of the same item
 *
 * Hamming distance thresholds for 64-bit pHash:
 *   0-8:  very likely duplicate
 *   9-12: possibly similar (manual review)
 *   13+:  different images
 */

const BLOCK_SIZE = 8;

function dct2d(input, width, height) {
  const temp = new Float64Array(width * height);
  const output = new Float64Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let u = 0; u < width; u++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        sum += input[y * width + x] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * width));
      }
      temp[y * width + u] = sum;
    }
  }

  for (let u = 0; u < width; u++) {
    for (let v = 0; v < height; v++) {
      let sum = 0;
      for (let y = 0; y < height; y++) {
        sum += temp[y * width + u] * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * height));
      }
      output[v * width + u] = sum;
    }
  }

  return output;
}

const perceptualHashFromBuffer = async (imageBuffer) => {
  try {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      sharp = null;
    }

    if (sharp) {
      const { data } = await sharp(imageBuffer)
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const floatData = new Float64Array(32 * 32);
      for (let i = 0; i < 32 * 32; i++) {
        floatData[i] = data[i];
      }

      const dct = dct2d(floatData, 32, 32);

      const allCoeffs = [];
      for (let y = 0; y < BLOCK_SIZE; y++) {
        for (let x = 0; x < BLOCK_SIZE; x++) {
          allCoeffs.push(dct[y * 32 + x]);
        }
      }
      const allSorted = [...allCoeffs].sort((a, b) => a - b);
      const allMedian = allSorted[Math.floor(allSorted.length / 2)];

      const hashBits = allCoeffs.map((v) => (v >= allMedian ? 1 : 0)).join('');
      const hash = BigInt('0b' + hashBits).toString(16).padStart(16, '0');
      return hash;
    }

    return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  } catch (err) {
    return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  }
};

const hammingDistance = (hash1, hash2) => {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64;
  let distance = 0;
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

/**
 * Perceptual hash of the horizontally flipped (mirrored) image.
 *
 * Fraudsters mirror a stolen image to evade pHash detection — the DCT
 * hash of a flipped image differs by a large hamming distance (observed
 * ~53 on real test images), so the plain hash never matches. Hashing the
 * flopped variant as well lets duplicate checks catch mirrored copies:
 * a mirrored upload's own hash matches the original's mirror hash.
 *
 * Falls back to the normal hash when sharp is unavailable (no extra
 * false positives, just no mirror coverage).
 */
const mirrorPerceptualHashFromBuffer = async (imageBuffer) => {
  try {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      sharp = null;
    }

    if (!sharp) {
      return perceptualHashFromBuffer(imageBuffer);
    }

    const flopped = await sharp(imageBuffer).flop().png().toBuffer();
    return perceptualHashFromBuffer(flopped);
  } catch (err) {
    return perceptualHashFromBuffer(imageBuffer);
  }
};

module.exports = {
  perceptualHashFromBuffer,
  mirrorPerceptualHashFromBuffer,
  hammingDistance,
  similarity,
};
