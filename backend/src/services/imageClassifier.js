/**
 * Image Classification Service using MobileNet (TensorFlow.js).
 *
 * Uses a pre-trained MobileNet model to classify product images into
 * the ReSell category taxonomy. Image decoding uses `sharp` (already
 * a project dependency) to convert buffers to raw pixel tensors.
 *
 * Falls back to keyword-based classification if TF.js/MobileNet
 * fails to load or if classification confidence is too low.
 */

let tf;
let mobilenet;
let modelLoaded = false;
let loadPromise = null;

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

try {
  tf = require('@tensorflow/tfjs');
  mobilenet = require('@tensorflow-models/mobilenet');
} catch {
  tf = null;
  mobilenet = null;
}

/**
 * Mapping from MobileNet ImageNet labels to ReSell category taxonomy.
 * Keys are lowercase substrings that match MobileNet's className output.
 */
const IMAGENET_TO_CATEGORY = {
  // Electronics
  'cellular telephone': 'Electronics',
  'cellphone': 'Electronics',
  'mobile phone': 'Electronics',
  'notebook': 'Electronics',
  'laptop': 'Electronics',
  'desktop computer': 'Electronics',
  'monitor': 'Electronics',
  'television': 'Electronics',
  'screen': 'Electronics',
  'ipod': 'Electronics',
  'digital camera': 'Electronics',
  'camera': 'Electronics',
  'webcam': 'Electronics',
  'headphone': 'Electronics',
  'earphone': 'Electronics',
  'loudspeaker': 'Electronics',
  'speaker': 'Electronics',
  'printer': 'Electronics',
  'projector': 'Electronics',
  'game controller': 'Electronics',
  'joystick': 'Electronics',
  'remote control': 'Electronics',
  'mouse': 'Electronics',
  'computer keyboard': 'Electronics',

  // Fashion
  'shirt': 'Fashion',
  'polo shirt': 'Fashion',
  't-shirt': 'Fashion',
  'sweater': 'Fashion',
  'jacket': 'Fashion',
  'coat': 'Fashion',
  'dress': 'Fashion',
  'skirt': 'Fashion',
  'trousers': 'Fashion',
  'jean': 'Fashion',
  'sandal': 'Fashion',
  'shoe': 'Fashion',
  'running shoe': 'Fashion',
  'sneaker': 'Fashion',
  'boot': 'Fashion',
  'sunglasses': 'Fashion',
  'goggles': 'Fashion',
  'watch': 'Fashion',
  'wristlet': 'Fashion',
  'handbag': 'Fashion',
  'purse': 'Fashion',
  'wallet': 'Fashion',
  'backpack': 'Fashion',
  'suitcase': 'Fashion',
  'hat': 'Fashion',
  'beanie': 'Fashion',
  'scarf': 'Fashion',
  'necklace': 'Fashion',
  'ring': 'Fashion',
  'belt': 'Fashion',
  'tie': 'Fashion',
  'cardigan': 'Fashion',
  'jersey': 'Fashion',
  'raincoat': 'Fashion',
  'fur coat': 'Fashion',
  'brassiere': 'Fashion',

  // Home & Garden
  'table lamp': 'Home & Garden',
  'lampshade': 'Home & Garden',
  'chair': 'Home & Garden',
  'rocking chair': 'Home & Garden',
  'sofa': 'Home & Garden',
  'studio couch': 'Home & Garden',
  'table': 'Home & Garden',
  'desk': 'Home & Garden',
  'bookcase': 'Home & Garden',
  'shelf': 'Home & Garden',
  'bed': 'Home & Garden',
  'crib': 'Home & Garden',
  'wardrobe': 'Home & Garden',
  'dresser': 'Home & Garden',
  'coffee table': 'Home & Garden',
  'dining table': 'Home & Garden',
  'vacuum cleaner': 'Home & Garden',
  'microwave oven': 'Home & Garden',
  'toaster': 'Home & Garden',
  'coffee maker': 'Home & Garden',
  'blender': 'Home & Garden',
  'refrigerator': 'Home & Garden',
  'dishwasher': 'Home & Garden',
  'washing machine': 'Home & Garden',
  'clothes dryer': 'Home & Garden',
  'iron': 'Home & Garden',
  'fan': 'Home & Garden',
  'air conditioner': 'Home & Garden',
  'heater': 'Home & Garden',

  // Sports & Outdoors
  'bicycle': 'Sports & Outdoors',
  'motor scooter': 'Sports & Outdoors',
  'barbell': 'Sports & Outdoors',
  'dumbbell': 'Sports & Outdoors',
  'treadmill': 'Sports & Outdoors',
  'tennis racket': 'Sports & Outdoors',
  'baseball bat': 'Sports & Outdoors',
  'baseball glove': 'Sports & Outdoors',
  'football': 'Sports & Outdoors',
  'basketball': 'Sports & Outdoors',
  'soccer ball': 'Sports & Outdoors',
  'golf club': 'Sports & Outdoors',
  'ski': 'Sports & Outdoors',
  'surfboard': 'Sports & Outdoors',
  'kayak': 'Sports & Outdoors',
  'tent': 'Sports & Outdoors',
  'sleeping bag': 'Sports & Outdoors',
  'helmet': 'Sports & Outdoors',
  'skateboard': 'Sports & Outdoors',

  // Books & Media
  'book': 'Books & Media',
  'textbook': 'Books & Media',
  'comic book': 'Books & Media',
  'magazine': 'Books & Media',
  'newspaper': 'Books & Media',
  'vinyl record': 'Books & Media',

  // Toys & Games
  'toy': 'Toys & Games',
  'doll': 'Toys & Games',
  'teddy bear': 'Toys & Games',
  'puzzle': 'Toys & Games',
  'board game': 'Toys & Games',
  'jigsaw puzzle': 'Toys & Games',
  'lego': 'Toys & Games',
  'rubik': 'Toys & Games',

  // Beauty & Health
  'perfume': 'Beauty & Health',
  'cosmetics': 'Beauty & Health',
  'lipstick': 'Beauty & Health',
  'hair dryer': 'Beauty & Health',

  // Automotive
  'car': 'Automotive',
  'jeep': 'Automotive',
  'truck': 'Automotive',
  'motorcycle': 'Automotive',
  'wheel': 'Automotive',
  'tire': 'Automotive',
};

/**
 * Word-boundary label matchers, precompiled once.
 *
 * Substring matching (label.includes(key)) mis-mapped labels: e.g. the
 * MobileNet label "cardigan" contains "car" (→ Automotive) even though it
 * is clothing, and "bookcase" contains "book" (→ Books & Media) even though
 * it is furniture. Word boundaries make mapping precise while still
 * matching multi-word labels ("running shoe") and hyphenated ones
 * ("t-shirt").
 */
const LABEL_MATCHERS = Object.entries(IMAGENET_TO_CATEGORY).map(([key, category]) => ({
  key,
  category,
  regex: new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
}));

/**
 * Map MobileNet predictions to ReSell categories (pure function).
 *
 * Sums probabilities per category across the top predictions using
 * word-boundary label matching, returning the best-scoring category.
 *
 * @param {Array<{className: string, probability: number}>} predictions
 * @returns {{category: string, confidence: number, topLabels: Array}}
 */
const mapPredictionsToCategory = (predictions = []) => {
  const categoryScores = {};
  const topLabels = [];

  for (const pred of predictions) {
    const label = String(pred.className || '').toLowerCase();
    const prob = pred.probability || 0;

    topLabels.push({ label: pred.className, probability: prob });

    // Count each prediction at most once per category, using the longest
    // (most specific) matching label. Otherwise a label like
    // "running shoe" would double-count Fashion via both the
    // "running shoe" and "shoe" keys.
    const matchedByCategory = {};
    for (const { key, category, regex } of LABEL_MATCHERS) {
      if (regex.test(label)) {
        const prev = matchedByCategory[category];
        if (!prev || key.length > prev.length) {
          matchedByCategory[category] = key;
        }
      }
    }
    for (const category of Object.keys(matchedByCategory)) {
      categoryScores[category] = (categoryScores[category] || 0) + prob;
    }
  }

  let bestCategory = 'Other';
  let bestScore = 0;
  for (const [category, score] of Object.entries(categoryScores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return {
    category: bestCategory,
    confidence: bestScore > 0 ? Number(Math.min(0.95, bestScore).toFixed(2)) : 0,
    topLabels,
  };
};

/** Confidence threshold below which we don't auto-fill category. */
const CONFIDENCE_THRESHOLD = 0.15;

let model = null;

/**
 * Load the MobileNet model (lazy, once).
 */
const loadModel = async () => {
  if (modelLoaded && model) return model;
  if (loadPromise) return loadPromise;

  if (!tf || !mobilenet || !sharp) {
    return null;
  }

  loadPromise = (async () => {
    try {
      console.log('[ImageClassifier] Loading MobileNet model...');
      model = await mobilenet.load({ version: 2, alpha: 1.0 });
      modelLoaded = true;
      console.log('[ImageClassifier] MobileNet loaded');
      return model;
    } catch (err) {
      console.error('[ImageClassifier] Failed to load MobileNet:', err.message);
      loadPromise = null;
      return null;
    }
  })();

  return loadPromise;
};

/**
 * Classify an image buffer using MobileNet + sharp for decoding.
 *
 * 1. Decode the image buffer via sharp → raw RGB pixels at 224×224
 * 2. Convert to a Float32 tensor (normalized 0-1)
 * 3. Run MobileNet inference
 * 4. Map top predictions to ReSell categories
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<{category: string, confidence: number, topLabels: Array, source: string}>}
 */
const classifyImage = async (imageBuffer) => {
  const m = await loadModel();

  if (!m) {
    return { category: 'Other', confidence: 0, topLabels: [], source: 'unavailable' };
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    return { category: 'Other', confidence: 0, topLabels: [], source: 'no-buffer' };
  }

  let tensor = null;
  try {
    // Decode image buffer via sharp → 224x224 RGB raw pixels
    const { data, info } = await sharp(imageBuffer)
      .resize(224, 224, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert uint8 raw pixels to a float32 tensor [1, 224, 224, 3]
    const floatData = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      floatData[i] = data[i] / 255.0;
    }
    tensor = tf.tensor4d(floatData, [1, 224, 224, 3]);

    // Classify
    const predictions = await m.classify(tensor, 10);

    // Map ImageNet labels → ReSell categories (word-boundary matching)
    const { category, confidence, topLabels } = mapPredictionsToCategory(predictions);

    return {
      category,
      confidence,
      topLabels,
      source: 'mobilenet',
    };
  } catch (err) {
    console.error('[ImageClassifier] Classification failed:', err.message);
    return { category: 'Other', confidence: 0, topLabels: [], source: 'error' };
  } finally {
    if (tensor) tensor.dispose();
  }
};

module.exports = {
  classifyImage,
  loadModel,
  mapPredictionsToCategory,
  IMAGENET_TO_CATEGORY,
  CONFIDENCE_THRESHOLD,
};
