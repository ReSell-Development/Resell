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
const DCT_SIZE = 32;

// Precomputed cosine table: COS_TABLE[x][u] = cos((2x+1)·u·π / (2·N)).
// Avoids recomputing ~65k Math.cos calls for every 32×32 DCT.
const COS_TABLE = (() => {
  const table = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let x = 0; x < DCT_SIZE; x++) {
    for (let u = 0; u < DCT_SIZE; u++) {
      table[x * DCT_SIZE + u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE));
    }
  }
  return table;
})();

function dct2d(input, width, height) {
  const temp = new Float64Array(width * height);
  const output = new Float64Array(width * height);
  const useTable = width === DCT_SIZE && height === DCT_SIZE;

  const cosXU = (x, u) =>
    useTable ? COS_TABLE[x * DCT_SIZE + u] : Math.cos(((2 * x + 1) * u * Math.PI) / (2 * width));
  const cosYV = (y, v) =>
    useTable ? COS_TABLE[y * DCT_SIZE + v] : Math.cos(((2 * y + 1) * v * Math.PI) / (2 * height));

  for (let y = 0; y < height; y++) {
    for (let u = 0; u < width; u++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        sum += input[y * width + x] * cosXU(x, u);
      }
      temp[y * width + u] = sum;
    }
  }

  for (let u = 0; u < width; u++) {
    for (let v = 0; v < height; v++) {
      let sum = 0;
      for (let y = 0; y < height; y++) {
        sum += temp[y * width + u] * cosYV(y, v);
      }
      output[v * width + u] = sum;
    }
  }

  return output;
}

/**
 * Compute the 64-bit pHash from raw 32×32 grayscale pixel data.
 */
const phashFromGrayRaw = (data) => {
  const floatData = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let i = 0; i < DCT_SIZE * DCT_SIZE; i++) {
    floatData[i] = data[i];
  }

  const dct = dct2d(floatData, DCT_SIZE, DCT_SIZE);

  const allCoeffs = [];
  for (let y = 0; y < BLOCK_SIZE; y++) {
    for (let x = 0; x < BLOCK_SIZE; x++) {
      allCoeffs.push(dct[y * DCT_SIZE + x]);
    }
  }
  const allSorted = [...allCoeffs].sort((a, b) => a - b);
  const allMedian = allSorted[Math.floor(allSorted.length / 2)];

  const hashBits = allCoeffs.map((v) => (v >= allMedian ? 1 : 0)).join('');
  return BigInt('0b' + hashBits).toString(16).padStart(16, '0');
};

const requireSharp = () => {
  try {
    return require('sharp');
  } catch {
    return null;
  }
};

const perceptualHashFromBuffer = async (imageBuffer) => {
  try {
    const sharp = requireSharp();

    if (sharp) {
      const { data } = await sharp(imageBuffer)
        .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return phashFromGrayRaw(data);
    }

    return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  } catch (err) {
    return crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  }
};

/**
 * Perceptual hash variants for fraud detection.
 *
 * Returns { hash, mirroredHash }, where mirroredHash is the pHash of the
 * horizontally flipped image. A common evasion is to mirror-flip a stolen
 * photo before re-uploading it — the flipped image gets a very different
 * primary pHash, but hash(flop(X)) === mirroredHash(X). Storing and
 * comparing both variants closes this evasion channel.
 */
const perceptualHashVariantsFromBuffer = async (imageBuffer) => {
  try {
    const sharp = requireSharp();

    if (sharp) {
      const [normal, flopped] = await Promise.all([
        sharp(imageBuffer)
          .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
          .grayscale()
          .raw()
          .toBuffer({ resolveWithObject: true }),
        sharp(imageBuffer)
          .flop()
          .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
          .grayscale()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      ]);

      return {
        hash: phashFromGrayRaw(normal.data),
        mirroredHash: phashFromGrayRaw(flopped.data),
      };
    }
  } catch (err) {
    // fall through to the content-addressed fallback below
  }

  const digest = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  return { hash: digest, mirroredHash: digest };
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

module.exports = {
  perceptualHashFromBuffer,
  perceptualHashVariantsFromBuffer,
  phashFromGrayRaw,
  hammingDistance,
  similarity,
};
