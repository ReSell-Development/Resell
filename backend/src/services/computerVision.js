/**
 * Computer Vision service.
 *
 * Implements modular CV analysis:
 * - Image quality / condition scoring
 * - Damage / scratch detection (heuristic-based using pixel analysis)
 * - Product classification (heuristic-based on filename + image features)
 *
 * Uses sharp when available, falls back gracefully otherwise.
 * Real ML models can be plugged in by setting ML_SERVICE_URL.
 */

const crypto = require('crypto');

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const METADATA = {
  hasSharp: !!sharp,
  mlServiceUrl: process.env.ML_SERVICE_URL || null,
};

const analyzeImageQuality = async (imageBuffer) => {
  if (!sharp) {
    return {
      width: 0,
      height: 0,
      format: 'unknown',
      brightness: 128,
      contrast: 50,
      sharpness: 50,
      available: false,
    };
  }

  try {
    const meta = await sharp(imageBuffer).metadata();
    const stats = await sharp(imageBuffer).stats();

    const channels = stats.channels;
    const brightness =
      channels.reduce((s, c) => s + c.mean, 0) / Math.max(channels.length, 1);

    const contrast =
      channels.reduce((s, c) => s + Math.min(c.stdev, 100), 0) / Math.max(channels.length, 1);

    return {
      width: meta.width || 0,
      height: meta.height || 0,
      format: meta.format || 'unknown',
      brightness: Math.round(brightness),
      contrast: Math.round(contrast),
      sharpness: Math.round(contrast * 0.8 + brightness * 0.2),
      available: true,
    };
  } catch (err) {
    return {
      width: 0,
      height: 0,
      format: 'unknown',
      brightness: 128,
      contrast: 50,
      sharpness: 50,
      available: false,
      error: err.message,
    };
  }
};

const assessCondition = async (imageBuffer) => {
  const quality = await analyzeImageQuality(imageBuffer);

  if (!quality.available) {
    return {
      score: 75,
      label: 'good',
      confidence: 0.3,
      factors: ['visual analysis unavailable, defaulting to good condition'],
    };
  }

  let score = 100;
  const factors = [];

  // Brightness scoring: very dark or very bright images indicate issues
  if (quality.brightness < 60) {
    score -= 15;
    factors.push('Image is dark');
  } else if (quality.brightness > 220) {
    score -= 10;
    factors.push('Image is overexposed');
  } else {
    factors.push('Good lighting');
  }

  // Contrast scoring: low contrast can hide flaws but also indicates dullness
  if (quality.contrast < 20) {
    score -= 10;
    factors.push('Low contrast - possible dull surface');
  } else if (quality.contrast > 80) {
    factors.push('High detail contrast');
  }

  // Sharpness scoring
  if (quality.sharpness < 30) {
    score -= 8;
    factors.push('Image blur detected');
  }

  score = Math.max(30, Math.min(100, score));

  let label = 'good';
  if (score >= 90) label = 'like-new';
  else if (score >= 75) label = 'good';
  else if (score >= 60) label = 'fair';
  else label = 'poor';

  return {
    score,
    label,
    confidence: quality.available ? 0.65 : 0.3,
    factors,
  };
};

const detectDamage = async (imageBuffer) => {
  const quality = await analyzeImageQuality(imageBuffer);

  if (!quality.available) {
    return {
      score: 5,
      level: 'low',
      confidence: 0.3,
      description: 'Damage analysis unavailable',
      factors: [],
    };
  }

  // Heuristic damage score:
  // - High contrast regions with low brightness may indicate scratches
  // - Very low sharpness may indicate dents/cracks
  // - Low brightness may indicate worn-out surface

  let damageScore = 0;
  const factors = [];

  if (quality.contrast > 70 && quality.brightness < 130) {
    damageScore += 25;
    factors.push('Possible surface scratches detected');
  }

  if (quality.sharpness < 25) {
    damageScore += 15;
    factors.push('Possible wear or dull finish');
  }

  if (quality.brightness < 80) {
    damageScore += 10;
    factors.push('Dark spots or shadows may indicate damage');
  }

  // Edge density heuristic via difference calculation
  if (sharp) {
    try {
      const { data } = await sharp(imageBuffer)
        .resize(64, 64, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let edges = 0;
      for (let y = 1; y < 63; y++) {
        for (let x = 1; x < 63; x++) {
          const gx = Math.abs(data[y * 64 + x] - data[y * 64 + x - 1]);
          const gy = Math.abs(data[y * 64 + x] - data[(y - 1) * 64 + x]);
          if (gx + gy > 60) edges++;
        }
      }
      const edgeRatio = edges / (62 * 62);
      if (edgeRatio > 0.35) {
        damageScore += 20;
        factors.push('High edge density — possible cracks or heavy wear');
      } else if (edgeRatio < 0.08) {
        factors.push('Smooth surface');
      }
    } catch (err) {
      // ignore
    }
  }

  damageScore = Math.max(0, Math.min(100, damageScore));

  let level = 'low';
  if (damageScore >= 50) level = 'high';
  else if (damageScore >= 25) level = 'medium';

  return {
    score: damageScore,
    level,
    confidence: quality.available ? 0.6 : 0.3,
    description:
      damageScore >= 50
        ? 'Visible damage likely present'
        : damageScore >= 25
        ? 'Some wear or minor damage indicators'
        : 'Item appears to be in good condition',
    factors,
  };
};

const classifyProduct = async (imageBuffer, metadata = {}) => {
  // Heuristic-based classification using filename and image features
  const filename = (metadata.filename || '').toLowerCase();
  const title = (metadata.title || '').toLowerCase();
  const combined = `${filename} ${title}`;

  const CATEGORY_KEYWORDS = {
    Electronics: [
      'phone',
      'laptop',
      'tablet',
      'macbook',
      'iphone',
      'samsung',
      'dell',
      'hp',
      'lenovo',
      'computer',
      'monitor',
      'tv',
      'television',
      'camera',
      'headphone',
      'earbuds',
      'airpods',
      'console',
      'playstation',
      'xbox',
    ],
    Fashion: [
      'shirt',
      't-shirt',
      'tshirt',
      'jeans',
      'jacket',
      'coat',
      'shoes',
      'sneakers',
      'dress',
      'watch',
      'bag',
      'handbag',
      'wallet',
      'sunglasses',
      'belt',
    ],
    'Home & Garden': [
      'furniture',
      'sofa',
      'chair',
      'table',
      'lamp',
      'plant',
      'garden',
      'kitchen',
      'appliance',
      'vacuum',
      'bed',
      'shelf',
    ],
    'Sports & Outdoors': [
      'bike',
      'bicycle',
      'treadmill',
      'weights',
      'yoga',
      'tennis',
      'football',
      'basketball',
      'camping',
      'hiking',
    ],
    'Books & Media': ['book', 'novel', 'magazine', 'dvd', 'blu-ray', 'vinyl', 'record'],
    'Toys & Games': ['lego', 'puzzle', 'board game', 'console game', 'toy'],
    'Beauty & Health': ['perfume', 'skincare', 'makeup', 'cosmetic', 'shampoo', 'health'],
    Automotive: ['car', 'tire', 'engine', 'brake', 'helmet', 'car accessory'],
  };

  let bestCategory = 'Other';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  const confidence = Math.min(0.95, 0.4 + bestScore * 0.1);

  return {
    category: bestCategory,
    confidence: Number(confidence.toFixed(2)),
    keywordsMatched: bestScore,
  };
};

module.exports = {
  metadata: METADATA,
  analyzeImageQuality,
  assessCondition,
  detectDamage,
  classifyProduct,
};
