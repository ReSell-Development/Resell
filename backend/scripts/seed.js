/* eslint-disable no-console */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const Sale = require('../src/models/Sale');
const Review = require('../src/models/Review');
const Offer = require('../src/models/Offer');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const Notification = require('../src/models/Notification');
const ImageUploadRecord = require('../src/models/ImageUploadRecord');

const {
  perceptualHashFromBuffer,
  mirrorPerceptualHashFromBuffer,
} = require('../src/services/imageHash');
const { detectRisk } = require('../src/services/fraudDetection');

const IMAGES_DIR = path.join(__dirname, '..', 'public', 'seed-images');
const BASE_URL = process.env.SEED_BASE_URL || 'http://localhost:5000';

const PASSWORD = 'Password123!';
const DAY_MS = 24 * 60 * 60 * 1000;

const CATEGORIES = [
  { name: 'Electronics', icon: 'smartphone' },
  { name: 'Mobile Phones', icon: 'phone' },
  { name: 'Computers & Laptops', icon: 'laptop' },
  { name: 'Fashion', icon: 'shirt' },
  { name: 'Home & Garden', icon: 'home' },
  { name: 'Sports & Outdoors', icon: 'activity' },
  { name: 'Books & Media', icon: 'book' },
  { name: 'Toys & Games', icon: 'gamepad' },
  { name: 'Beauty & Health', icon: 'heart' },
  { name: 'Automotive', icon: 'truck' },
];

const PRODUCTS = [
  {
    title: 'Milton Thermosteel Flask 1L — Teal',
    category: 'Home & Garden',
    seller: 'priya',
    price: 550,
    originalPrice: 1200,
    brand: 'Milton',
    model: 'Thermosteel 1L',
    condition: 'good',
    yearsUsed: 1,
    image: 'milton-flask-teal.jpg',
    description:
      'Genuine Milton Thermosteel 1-litre flask in teal, bought last winter for office use. Keeps chai hot for roughly 8 hours and water cold through the afternoon. There are two faint scuffs near the base from daily desk use, but the vacuum seal is perfect and the cap threads smoothly with zero leaks.',
    specs: [
      { key: 'Capacity', value: '1 litre' },
      { key: 'Color', value: 'Teal' },
      { key: 'Insulation', value: 'Double-wall vacuum, hot & cold' },
    ],
  },
  {
    title: 'iPhone 12 64GB — Blue',
    category: 'Electronics',
    seller: 'priya',
    price: 32000,
    originalPrice: 79900,
    brand: 'Apple',
    model: 'iPhone 12',
    condition: 'good',
    yearsUsed: 2,
    image: 'iphone-12-blue.jpg',
    description:
      'iPhone 12 in the blue finish with 64GB storage, boxed with the original cable and paperwork. Battery health is 84% and everything works — Face ID, both cameras, speakers. Always kept in a case so the frame and glass are clean. Selling because my office issued me a work phone.',
    specs: [
      { key: 'Storage', value: '64GB' },
      { key: 'Color', value: 'Blue' },
      { key: 'Battery Health', value: '84%' },
      { key: 'Includes', value: 'Box, cable, paperwork' },
    ],
  },
  {
    title: 'HP Pavilion Gaming Laptop i5',
    category: 'Electronics',
    seller: 'arjun',
    price: 24000,
    originalPrice: 62000,
    brand: 'HP',
    model: 'Pavilion Gaming 15',
    condition: 'fair',
    yearsUsed: 3,
    image: 'hp-pavilion-gaming.jpg',
    description:
      'HP Pavilion Gaming 15 with an Intel i5, GTX 1650 graphics, 8GB RAM and a 512GB SSD. Runs GTA V, Valorant and Premiere Pro without complaints. The keyboard backlight works but two keys have shiny legends, and the battery lasts about 90 minutes unplugged — priced accordingly, charger included.',
    specs: [
      { key: 'Processor', value: 'Intel Core i5' },
      { key: 'Graphics', value: 'GTX 1650' },
      { key: 'RAM / Storage', value: '8GB / 512GB SSD' },
    ],
  },
  {
    title: 'boAt Rockerz Headphones',
    category: 'Electronics',
    seller: 'arjun',
    price: 1400,
    originalPrice: 2990,
    brand: 'boAt',
    model: 'Rockerz 400',
    condition: 'like-new',
    yearsUsed: 0,
    image: 'boat-rockerz.jpg',
    description:
      'boAt Rockerz on-ear Bluetooth headphones in black, bought four months ago and barely used — I switched to wired earphones for the gym. Pairs instantly, cushions are uncreased, battery easily gives the full claimed 8 hours. Comes with the charging cable and the original box.',
    specs: [
      { key: 'Type', value: 'On-ear Bluetooth' },
      { key: 'Battery Life', value: 'Up to 8 hours' },
      { key: 'Includes', value: 'Charging cable, box' },
    ],
  },
  {
    title: 'Nike Running Shoes Size 9',
    category: 'Fashion',
    seller: 'meera',
    price: 1800,
    originalPrice: 5995,
    brand: 'Nike',
    model: 'Air Max',
    condition: 'good',
    yearsUsed: 1,
    image: 'nike-running-9.jpg',
    description:
      'Nike Air Max running shoes in UK size 9, white with the orange swoosh. Used for morning walks for about a year — the air cushioning still feels springy and the tread has plenty of life. Washed and deodorised. Selling because I bought the wrong size in my next pair and these no longer get worn.',
    specs: [
      { key: 'Size', value: 'UK 9' },
      { key: 'Color', value: 'White / Orange' },
      { key: 'Use', value: 'Walking, light running' },
    ],
  },
  {
    title: 'Leather Office Bag',
    category: 'Fashion',
    seller: 'priya',
    price: 1600,
    originalPrice: 3500,
    brand: 'Hidesign',
    model: 'Messenger',
    condition: 'like-new',
    yearsUsed: 0,
    image: 'leather-office-bag.jpg',
    description:
      'Full-grain tan leather messenger bag that fits a 15-inch laptop plus files. Bought for a client-facing role I left within a month, so it has been carried maybe six times — the leather is developing a lovely patina and all buckles, straps and the lining are flawless.',
    specs: [
      { key: 'Material', value: 'Full-grain leather' },
      { key: 'Fits', value: '15-inch laptop' },
      { key: 'Color', value: 'Tan' },
    ],
  },
  {
    title: 'Study Table Lamp — LED',
    category: 'Home & Garden',
    seller: 'meera',
    price: 450,
    originalPrice: 1299,
    brand: 'Philips',
    model: 'Air 61013',
    condition: 'good',
    yearsUsed: 2,
    image: 'desk-lamp-led.jpg',
    description:
      'Philips LED study lamp with three colour temperatures and a flexible neck. Perfect working order — bright, flicker-free light that got me through two exam seasons. Selling because my new PG room already has one.',
    specs: [
      { key: 'Light', value: 'LED, 3 colour modes' },
      { key: 'Power', value: 'Mains, 5W' },
    ],
  },
  {
    title: 'Wooden Bookshelf — 3 Tier',
    category: 'Home & Garden',
    seller: 'arjun',
    price: 1500,
    originalPrice: 4500,
    brand: 'WoodenStreet',
    model: '3-Tier Shelf',
    condition: 'fair',
    yearsUsed: 4,
    image: 'bookshelf-3tier.jpg',
    description:
      'Solid-looking white-painted wooden bookshelf with three roomy tiers — held my entire engineering reference shelf plus novels. Structurally rock solid with no wobble, though there are paint chips on two edges and sticker residue on one side. You will need a friend to carry it; I can help load it downstairs.',
    specs: [
      { key: 'Tiers', value: '3' },
      { key: 'Finish', value: 'White-painted wood' },
      { key: 'Assembly', value: 'Comes assembled' },
    ],
  },
  {
    title: 'Adjustable Dumbbells Pair 5–20kg',
    category: 'Sports & Outdoors',
    seller: 'priya',
    price: 3500,
    originalPrice: 8000,
    brand: 'Kore',
    model: 'Adjustable 20kg',
    condition: 'good',
    yearsUsed: 2,
    image: 'dumbbells-pair.jpg',
    description:
      'Pair of spin-lock adjustable dumbbells, 5 to 20kg each with plates and collars. Knurling still grippy, no rust, collars tighten properly. My building gym reopened so these are gathering dust — ideal starter set for a home workout corner. Local pickup only, they are heavy.',
    specs: [
      { key: 'Weight Range', value: '5–20 kg per dumbbell' },
      { key: 'Type', value: 'Spin-lock adjustable' },
      { key: 'Pickup', value: 'Local only' },
    ],
  },
  {
    title: 'Yoga Mat 6mm',
    category: 'Sports & Outdoors',
    seller: 'meera',
    price: 400,
    originalPrice: 999,
    brand: 'Boldfit',
    model: 'Pro 6mm',
    condition: 'like-new',
    yearsUsed: 0,
    image: 'yoga-mat-6mm.jpg',
    description:
      'Boldfit 6mm anti-skid yoga mat in grey, used for exactly three home sessions before I joined a studio that provides mats. No tears, no peeling, texture like new — wiped down after every use. Rolls up with its carry strap, which is included.',
    specs: [
      { key: 'Thickness', value: '6 mm' },
      { key: 'Material', value: 'Anti-skid TPE' },
      { key: 'Includes', value: 'Carry strap' },
    ],
  },
  {
    title: 'NCERT Physics Class 11 Set',
    category: 'Books & Media',
    seller: 'arjun',
    price: 350,
    originalPrice: 1200,
    brand: 'NCERT',
    model: 'Class 11 Physics I & II',
    condition: 'good',
    yearsUsed: 2,
    image: 'ncert-physics-set.jpg',
    description:
      'Both NCERT Class 11 Physics textbooks, Part 1 and Part 2, latest rationalised syllabus edition. Bindings tight, no missing pages, only light pencil underlining in the first three chapters which erases cleanly. A second full set of notes from my coaching is tucked inside free if you want it.',
    specs: [
      { key: 'Books', value: 'Physics Part 1 + Part 2' },
      { key: 'Board', value: 'CBSE / NCERT' },
      { key: 'Extras', value: 'Coaching notes included' },
    ],
  },
  {
    title: 'Samsung 32-inch Monitor',
    category: 'Electronics',
    seller: 'meera',
    price: 6200,
    originalPrice: 12500,
    brand: 'Samsung',
    model: 'LF32 1080p',
    condition: 'good',
    yearsUsed: 2,
    image: 'samsung-monitor-32.jpg',
    description:
      'Samsung 32-inch Full HD monitor — massive upgrade for work-from-home spreadsheets and movie nights. No dead pixels, no backlight bleed, stand and HDMI cable included. The body has one tiny scuff on the rear bezel you never see. Selling only because I am moving abroad next month.',
    specs: [
      { key: 'Size', value: '32 inch' },
      { key: 'Resolution', value: '1920 × 1080' },
      { key: 'Includes', value: 'Stand, HDMI cable' },
    ],
  },
];

// ── DEMO DUPLICATE DETECTION LISTINGS ─────────────────────────────────────────
// These are extra listings that cover fraud-detection cases 2–5 (see Task 2 —
// each description includes one line explaining what it demonstrates).
// Exact-duplicate (Case 1), mirror/rotation and re-photograph scenarios are
// exercised by backend/scripts/fraud_matrix.js against real images.
// Cases 2, 3, 4 (image/identity signals) and Case 5 (scam-text pattern signals)
// are added below. Case 6 (listing-velocity burst) is optional — see
// BURST_PRODUCTS and the --with-burst flag.

const DEMO_PRODUCTS = [
  // CASE 2A — re-photographed variant: 5% crop + brightness 1.1 + JPEG q70 applied by Sharp at seed time.
  // Expected: CNN/CLIP supporting signal only. NOT high risk — demonstrates "visual similarity alone never proves fraud."
  {
    title: '[DEMO] Samsung Galaxy S22 Ultra — Re-photo Variant',
    category: 'Mobile Phones',
    seller: 'arjun',
    price: 480,
    originalPrice: 799,
    brand: 'Samsung',
    model: 'Galaxy S22 Ultra',
    condition: 'good',
    yearsUsed: 1,
    image: 'iphone-13-midnight.jpg',
    imageTransform: 'rephotograph', // 5% crop + brightness 1.1 + q70
    description:
      '[DEMO CASE 2] Same product category but photographed differently — demonstrates that visual similarity (CNN/CLIP) alone never flags as high risk; only pHash exact match triggers the +35 duplicate penalty.',
    specs: [{ key: 'DEMO', value: 'Case 2 — re-photographed variant' }],
  },
  // CASE 2B — second listing for Case 2 demo (different seller of same product category)
  {
    title: '[DEMO] iPhone 13 — Different Angle Shot',
    category: 'Mobile Phones',
    seller: 'meera',
    price: 490,
    originalPrice: 799,
    brand: 'Apple',
    model: 'iPhone 13',
    condition: 'good',
    yearsUsed: 1,
    image: 'iphone-demo-case2.jpg',
    description:
      '[DEMO CASE 2] Distinct photo of same product category from different seller — CNN/CLIP may show visual similarity; expected riskLevel: low to medium (supporting signal only, no pHash hit).',
    specs: [{ key: 'DEMO', value: 'Case 2 — separate angle listing' }],
  },
  // CASE 3A — legitimate same-category sneakers (Adidas — distinct photo)
  {
    title: '[DEMO] Adidas Ultraboost 22 — Black, US 9',
    category: 'Fashion',
    seller: 'priya',
    price: 80,
    originalPrice: 180,
    brand: 'Adidas',
    model: 'Ultraboost 22',
    condition: 'good',
    yearsUsed: 1,
    image: 'sneakers-demo-case3a.jpg',
    description:
      '[DEMO CASE 3] Distinct Adidas sneakers — same category as Nike AF1 but entirely different brand/photo. Expect ZERO duplicate signals: proves legitimate same-category sellers are not penalised.',
    specs: [{ key: 'DEMO', value: 'Case 3 — legitimate same-category seller A' }],
  },
  // CASE 3B — second legitimate same-category sneaker listing
  {
    title: '[DEMO] New Balance 550 — White/Green, US 10',
    category: 'Fashion',
    seller: 'arjun',
    price: 90,
    originalPrice: 150,
    brand: 'New Balance',
    model: '550',
    condition: 'like-new',
    yearsUsed: 0,
    image: 'sneakers-demo-case3b.jpg',
    description:
      '[DEMO CASE 3] Distinct New Balance sneakers from different seller — same category, different photo, different brand. Expect zero duplicate signals.',
    specs: [{ key: 'DEMO', value: 'Case 3 — legitimate same-category seller B' }],
  },
  // CASE 4 — mirror-flipped version of Case 1 image. Expect mirror-hash detection.
  {
    title: '[DEMO] iPhone 13 — Mirrored Listing',
    category: 'Mobile Phones',
    seller: 'meera',
    price: 510,
    originalPrice: 799,
    brand: 'Apple',
    model: 'iPhone 13',
    condition: 'good',
    yearsUsed: 1,
    image: 'iphone-13-midnight.jpg',
    imageTransform: 'mirror', // Sharp flop() applied at seed time
    description:
      '[DEMO CASE 4] Mirror-flipped (horizontally) version of the iphone-13-midnight image — demonstrates that mirrorPerceptualHash detects the flop() evasion: the stored mirrorHash of the base image matches the pHash of this listing.',
    specs: [{ key: 'DEMO', value: 'Case 4 — mirror-hash detection' }],
  },
  // CASE 5 — scam-text template: off-platform contact + urgency clichés. The
  // description is a keyword/regex demo, NOT a trained model (see README §7.10).
  // Expected text-scam signals (capped at +25 total):
  //   SUSPICIOUS_CONTACT_INFO (phone + email + WhatsApp) +10
  //   URGENCY_PRESSURE_PHRASES (>=4 clichés) +15
  //   EXCESSIVE_PUNCTUATION (>5 exclamation marks) +5
  //   LOWBALL_URGENCY_COMBO ("urgent" + price < 40% of original) +15
  // Served from a distinct re-photographed image so no pHash duplicate fires.
  {
    title: '[DEMO] iPhone 13 Pro — CASE 5 URGENT SALE!!!',
    category: 'Mobile Phones',
    seller: 'meera',
    price: 4000,
    originalPrice: 12000,
    brand: 'Apple',
    model: 'iPhone 13 Pro',
    condition: 'fair',
    yearsUsed: 2,
    image: 'dumbbells-pair.jpg',
    imageTransform: 'rephotograph',
    description:
      "[DEMO CASE 5] URGENT SALE need cash today!!! Moving abroad next week, this is the last date. Advance payment only — don't miss this, guaranteed lowest price, trust me!!! WhatsApp me on 9876543210 or email quickcash@example.com to pay advance. Calling is fine too: 9876543210.",
    specs: [{ key: 'DEMO', value: 'Case 5 — scam-text pattern signals' }],
  },
];

// ── OPTIONAL: LISTING-VELOCITY (BURST) DEMO — CASE 6 ─────────────────────────
// Created only with `--with-burst`. Five rapid listings from arjun's five-day-old
// account push his last-24h listing count to >= 5, so the listing-velocity
// signal (LISTING_BURST_NEW_ACCOUNT, +15) fires. The default seed deliberately
// stays below the threshold (arjun has 4 other listings, not 5) so a plain
// `node scripts/seed.js` shows no velocity signal. The burst listings live in
// "Toys & Games" (no other listings) with distinct images, so no pHash
// duplicate fires — the velocity signal is the only thing demonstrated.
const BURST_PRODUCTS = [
  {
    title: '[DEMO] CASE 6 Burst Listing 1 — Wooden Puzzle Set',
    category: 'Toys & Games',
    seller: 'arjun',
    price: 18,
    originalPrice: 40,
    brand: 'Melissa & Doug',
    condition: 'good',
    yearsUsed: 1,
    image: 'desk-lamp-led.jpg',
    description:
      'Fifty-piece wooden puzzle set for toddlers in an animal theme. Every piece is present and the box only shows light shelf wear.',
    specs: [{ key: 'DEMO', value: 'Case 6 — listing-velocity burst' }],
  },
  {
    title: '[DEMO] CASE 6 Burst Listing 2 — Magnetic Building Tiles',
    category: 'Toys & Games',
    seller: 'arjun',
    price: 26,
    originalPrice: 55,
    brand: 'Magna-Tiles',
    condition: 'like-new',
    yearsUsed: 1,
    image: 'office-chair-mesh.jpg',
    description:
      'Set of one hundred translucent magnetic building tiles. Cleaned and boxed, no missing magnets or cracked corners.',
    specs: [{ key: 'DEMO', value: 'Case 6 — listing-velocity burst' }],
  },
  {
    title: '[DEMO] CASE 6 Burst Listing 3 — Remote Control Car',
    category: 'Toys & Games',
    seller: 'arjun',
    price: 34,
    originalPrice: 70,
    brand: 'Traxxas',
    condition: 'good',
    yearsUsed: 2,
    image: 'dumbbells-pair.jpg',
    description:
      'Hobby-grade remote control buggy with a spare battery pack. Runs smoothly; the shell has minor scuffs from outdoor use.',
    specs: [{ key: 'DEMO', value: 'Case 6 — listing-velocity burst' }],
  },
  {
    title: '[DEMO] CASE 6 Burst Listing 4 — Board Game Bundle',
    category: 'Toys & Games',
    seller: 'arjun',
    price: 40,
    originalPrice: 85,
    brand: 'Asmodee',
    condition: 'good',
    yearsUsed: 2,
    image: 'harry-potter-books.jpg',
    description:
      'Bundle of three family strategy board games with all cards and tokens counted and complete. Rulebooks included.',
    specs: [{ key: 'DEMO', value: 'Case 6 — listing-velocity burst' }],
  },
  {
    title: '[DEMO] CASE 6 Burst Listing 5 — Plush Teddy Collection',
    category: 'Toys & Games',
    seller: 'arjun',
    price: 22,
    originalPrice: 50,
    brand: 'Gund',
    condition: 'like-new',
    yearsUsed: 0,
    image: 'sony-wh1000xm4.jpg',
    description:
      'Collection of four soft plush teddy bears in assorted sizes. Washed, odour-free, and stored in a smoke-free home.',
    specs: [{ key: 'DEMO', value: 'Case 6 — listing-velocity burst' }],
  },
];

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A listing counts as fully worker-processed when the image pipeline has
 * populated every aiAnalysis layer: CLIP embedding, hashes, histograms,
 * detections, classification, pricing and the fused risk assessment.
 */
const isFullyAnalyzed = (doc) => {
  const ai = doc?.aiAnalysis || {};
  return (
    Array.isArray(doc?.embedding) && doc.embedding.length === 512 &&
    Array.isArray(ai.imageHashes) && ai.imageHashes.length >= 2 &&
    Array.isArray(ai.detectedObjects) &&
    typeof ai.classification?.predictedCategory === 'string' &&
    ai.classification.predictedCategory.length > 0 &&
    ai.riskAssessment?.assessedAt != null &&
    (ai.priceRecommendation?.recommendedPrice || 0) > 0
  );
};

/**
 * Enqueue EVERY given listing through the BullMQ image worker and wait until
 * aiAnalysis is fully populated. Verifies Redis + ML reachability first and
 * exits non-zero (STOP) when either is unavailable. Jobs for listings that
 * are still incomplete after the first pass are requeued once.
 */
const enqueueFullWorkerPass = async (listings) => {
  console.log('\n[Seed] Verifying Redis + ML service reachability...');
  // The TCP probe runs once per module load and can flake under heavy
  // parallel load (jest + workers), so re-require (fresh probe) a few times
  // before concluding Redis is down. Failed probes create no connections.
  const queuesPath = require.resolve('../src/queues');
  let queues = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    delete require.cache[queuesPath];
    queues = require('../src/queues');
    try {
      await queues.whenConnected;
      break;
    } catch (err) {
      queues = null;
      if (attempt === 5) {
        console.error('[Seed] STOP: Redis unreachable — start Redis before seeding.');
        process.exit(1);
      }
      console.log(`[Seed] Redis probe attempt ${attempt} failed, retrying...`);
      await sleep(5000);
    }
  }
  const mlBase = process.env.ML_SERVICE_URL || 'http://localhost:8000';
  try {
    const res = await fetch(`${mlBase}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[Seed] ML service reachable:', mlBase);
  } catch (err) {
    console.error(`[Seed] STOP: ML service unreachable at ${mlBase} — ${err.message}`);
    process.exit(1);
  }

  const enqueue = async (docs) => {
    for (const p of docs) {
      const full = await Product.findById(p._id).lean();
      await queues.imageProcessingQueue.add('analyze-product', {
        productId: full._id.toString(),
        images: (full.images || []).map((img) => ({
          url: img.url,
          publicId: img.publicId,
          hash: img.perceptualHash,
        })),
        productData: {
          title: full.title,
          description: full.description,
          price: full.price,
          originalPrice: full.originalPrice,
          category: full.category,
          brand: full.brand,
          model: full.model,
          condition: full.condition,
          yearsUsed: full.yearsUsed,
          specifications: full.specifications || [],
          location: full.location || {},
          seller: full.seller?.toString(),
        },
      });
      console.log(`[Seed] Enqueued worker analysis for "${full.title}"`);
    }
  };

  console.log(`\n[Seed] Enqueuing ${listings.length} listings for full worker analysis...`);
  console.log('[Seed] (requires: npm run worker — start it in another terminal if not running)');
  await enqueue(listings);

  const ids = listings.map((p) => p._id);
  const POLL_MS = 15000;
  const DEADLINE_MS = 20 * 60 * 1000;
  const deadline = Date.now() + DEADLINE_MS;
  let requeued = false;
  for (;;) {
    await sleep(POLL_MS);
    const docs = await Product.find({ _id: { $in: ids } }).lean();
    const pending = docs.filter((d) => !isFullyAnalyzed(d));
    console.log(`[Seed] Worker progress: ${docs.length - pending.length}/${docs.length} fully analyzed`);
    if (pending.length === 0) {
      console.log('[Seed] All listings fully analyzed by the worker.');
      return;
    }
    if (Date.now() >= deadline) {
      if (!requeued) {
        console.log(`[Seed] Requeuing ${pending.length} incomplete listing(s) once...`);
        await enqueue(pending);
        requeued = true;
        continue;
      }
      console.error('[Seed] STOP: worker did not finish within the time budget. Incomplete:');
      for (const d of pending) console.error(`  - ${d.title} (${d._id})`);
      process.exit(1);
    }
  }
};

/**
 * Per-product verification table: title | auto-category | riskScore |
 * images OK | crops populated.
 */
const printCatalogTable = async (listings) => {
  const ids = listings.map((p) => p._id);
  const docs = await Product.find({ _id: { $in: ids } }).lean();
  console.log('\nTitle                                        | Auto-category        | Risk | Images | Crops');
  console.log('---------------------------------------------|----------------------|------|--------|------------------');
  for (const d of docs) {
    const ai = d.aiAnalysis || {};
    const crops = Array.isArray(ai.detectedObjects) ? ai.detectedObjects : [];
    const withEmb = crops.filter((c) => Array.isArray(c.cropEmbedding) && c.cropEmbedding.length > 0).length;
    const imagesOk = (d.images || []).length > 0 && (ai.imageHashes || []).length >= 2 ? 'OK' : 'MISSING';
    console.log(
      `${String(d.title).substring(0, 44).padEnd(44)} | ` +
      `${String(ai.classification?.predictedCategory || '?').substring(0, 20).padEnd(20)} | ` +
      `${String(ai.riskAssessment?.riskScore ?? '?').padEnd(4)} | ` +
      `${imagesOk.padEnd(6)} | ` +
      `${crops.length} crops (${withEmb} w/ embedding)`
    );
  }
  console.log('');
};

/**
 * Load a real image from IMAGES_DIR, optionally apply a transform, resize to
 * max 1200px and return the JPEG buffer.
 */
const loadImage = async (filename, transform) => {
  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Seed image not found: ${filePath}. Run: node backend/scripts/download-seed-images.js`);
  }
  let pipeline = sharp(fs.readFileSync(filePath));

  if (transform === 'mirror') {
    // Case 4 — horizontal flip to test mirror-hash detection
    pipeline = pipeline.flop();
  } else if (transform === 'rephotograph') {
    // Case 2 — simulate re-photographed: 5% crop + brightness 1.1 + JPEG q70
    const meta = await sharp(fs.readFileSync(filePath)).metadata();
    const w = meta.width || 1200;
    const h = meta.height || 1200;
    const cropW = Math.round(w * 0.95);
    const cropH = Math.round(h * 0.95);
    const left = Math.round((w - cropW) / 2);
    const top = Math.round((h - cropH) / 2);
    pipeline = pipeline
      .extract({ left, top, width: cropW, height: cropH })
      .modulate({ brightness: 1.1 });
  }

  return pipeline
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: transform === 'rephotograph' ? 70 : 80 })
    .toBuffer();
};

const buildProductDoc = (tpl, userId, categoryId, imageInfo, hash, mirrorHash, now) => {
  return {
    title: tpl.title,
    description: tpl.description,
    price: tpl.price,
    originalPrice: tpl.originalPrice || 0,
    currencyCode: 'INR',
    category: categoryId,
    brand: tpl.brand || '',
    model: tpl.model || '',
    condition: tpl.condition,
    yearsUsed: tpl.yearsUsed || 0,
    specifications: tpl.specs || [],
    location: { city: 'Bengaluru', state: 'KA', country: 'India' },
    images: [
      {
        url: imageInfo.url,
        publicId: `seed_${slugify(tpl.title)}`,
        isPrimary: true,
        perceptualHash: hash,
      },
    ],
    seller: userId,
    status: 'active',
    views: 12 + ((tpl.title.length * 7) % 130),
    favoritesCount: 1 + (tpl.title.length % 6),
    aiAnalysis: {
      classification: { predictedCategory: tpl.category, confidence: 0.88 },
      conditionScore: tpl.condition === 'like-new' ? 92 : 78,
      damageScore: tpl.condition === 'like-new' ? 4 : 18,
      damageLevel: tpl.condition === 'like-new' ? 'low' : 'medium',
      imageHashes: [hash, mirrorHash],
      priceRecommendation: {
        recommendedPrice: Math.round(tpl.price * 0.97),
        minPrice: Math.round(tpl.price * 0.82),
        maxPrice: Math.round(tpl.price * 1.12),
        confidence: 0.8,
        explanation: `Depreciation + condition adjustment for ${tpl.condition} ${tpl.title}.`,
        factors: [
          `MSRP ${tpl.originalPrice || 0}`,
          `Asking ${tpl.price}`,
          `${tpl.yearsUsed || 0} year(s) used`,
        ],
        source: 'heuristic',
      },
      riskAssessment: {
        riskScore: 0,
        riskLevel: 'low',
        factors: [],
        assessedAt: now,
      },
      lastAnalyzedAt: now,
    },
  };
};

const seed = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('[Seed] MONGODB_URI not set — create backend/.env (see backend/.env.example).');
    process.exit(1);
  }

  // Ensure seed images exist
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error('[Seed] Seed images directory not found. Run: node backend/scripts/download-seed-images.js');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('[Seed] Connected to MongoDB');

  const existingUsers = await User.countDocuments();
  const force = process.argv.includes('--force');
  if (existingUsers > 0) {
    if (!force) {
      console.log('[Seed] Demo data already exists. Pass --force to reseed');
      await mongoose.disconnect();
      process.exit(0);
    }
    console.log('[Seed] --force: wiping demo-managed collections');
  }

  const managed = [
    User, Category, Product, Sale, Review, Offer, Conversation, Message,
    Notification, ImageUploadRecord,
  ];
  await Promise.all(managed.map((M) => M.deleteMany({})));
  console.log('[Seed] Cleaned collections');

  const now = Date.now();

  const admin = await User.create({
    name: 'Admin',
    email: 'admin@resell.dev',
    password: PASSWORD,
    role: 'admin',
    isVerified: true,
    location: 'Bengaluru',
  });

  const priya = await User.create({
    name: 'Priya Nair',
    email: 'priya@resell.dev',
    password: PASSWORD,
    role: 'seller',
    bio: 'Tech and home-goods reseller — everything I list is clean, tested and fairly priced.',
    location: 'Bengaluru',
    isVerified: true,
    averageResponseMinutes: 18,
  });

  const arjun = await User.create({
    name: 'Arjun Mehta',
    email: 'arjun@resell.dev',
    password: PASSWORD,
    role: 'seller',
    location: 'Bengaluru',
    averageResponseMinutes: 320,
  });

  const meera = await User.create({
    name: 'Meera Iyer',
    email: 'meera@resell.dev',
    password: PASSWORD,
    role: 'seller',
    location: 'Mumbai',
    isVerified: true,
    averageResponseMinutes: 45,
  });

  await User.collection.updateOne({ _id: priya._id }, { $set: { createdAt: new Date(now - 300 * DAY_MS) } });
  await User.collection.updateOne({ _id: arjun._id }, { $set: { createdAt: new Date(now - 5 * DAY_MS) } });
  await User.collection.updateOne({ _id: meera._id }, { $set: { createdAt: new Date(now - 200 * DAY_MS) } });
  const usersByName = { admin, priya, arjun, meera };
  console.log('[Seed] Users created');

  const categoriesByName = {};
  for (const c of CATEGORIES) {
    const cat = await Category.create({ ...c, slug: slugify(c.name) });
    categoriesByName[c.name] = cat;
  }
  console.log(`[Seed] Categories created (${CATEGORIES.length})`);

  // Load real images once per unique filename+transform combo
  const imageCache = {};
  const getCacheKey = (filename, transform) => filename + (transform ? ':' + transform : '');

  const withBurst = process.argv.includes('--with-burst');
  const allTemplates = withBurst
    ? [...PRODUCTS, ...DEMO_PRODUCTS, ...BURST_PRODUCTS]
    : [...PRODUCTS, ...DEMO_PRODUCTS];
  for (const tpl of allTemplates) {
    const key = getCacheKey(tpl.image, tpl.imageTransform);
    if (!imageCache[key]) {
      console.log(`[Seed] Loading image: ${key}`);
      imageCache[key] = await loadImage(tpl.image, tpl.imageTransform);
    }
  }

  // Create main products
  const products = [];
  for (let i = 0; i < PRODUCTS.length; i++) {
    const tpl = PRODUCTS[i];
    const key = getCacheKey(tpl.image, tpl.imageTransform);
    const buffer = imageCache[key];
    const hash = await perceptualHashFromBuffer(buffer);
    const mirrorHash = await mirrorPerceptualHashFromBuffer(buffer);
    const doc = buildProductDoc(
      tpl,
      usersByName[tpl.seller]._id,
      categoriesByName[tpl.category]._id,
      { url: `${BASE_URL}/public/seed-images/${tpl.image}` },
      hash,
      mirrorHash,
      new Date(now - i * 3600 * 1000)
    );
    const product = await Product.create(doc);
    products.push(product);
  }

  const flask = products[0];
  const priyaProducts = products.filter((p) => p.seller.equals(usersByName.priya._id));
  console.log(`[Seed] Main products created (${products.length}) — new realistic catalog (INR)`);

  // Create DEMO products (cases 2, 3, 4)
  const demoProducts = [];
  for (let i = 0; i < DEMO_PRODUCTS.length; i++) {
    const tpl = DEMO_PRODUCTS[i];
    const key = getCacheKey(tpl.image, tpl.imageTransform);
    const buffer = imageCache[key];
    const hash = await perceptualHashFromBuffer(buffer);
    const mirrorHash = await mirrorPerceptualHashFromBuffer(buffer);
    // Mirror image filename suffix for serving
    const servedFilename = tpl.imageTransform
      ? `${tpl.image.replace('.jpg', '')}-${tpl.imageTransform}.jpg`
      : tpl.image;
    // Write transformed image to disk so it can be served
    if (tpl.imageTransform) {
      const destPath = path.join(IMAGES_DIR, servedFilename);
      if (!fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, buffer);
        console.log(`[Seed] Written transformed image: ${servedFilename}`);
      }
    }
    const doc = buildProductDoc(
      tpl,
      usersByName[tpl.seller]._id,
      categoriesByName[tpl.category]._id,
      { url: `${BASE_URL}/public/seed-images/${servedFilename}` },
      hash,
      mirrorHash,
      new Date(now - (PRODUCTS.length + i) * 3600 * 1000)
    );
    const product = await Product.create(doc);
    demoProducts.push(product);
  }
  console.log(`[Seed] DEMO products created (${demoProducts.length}) — cases 2, 3, 4, 5`);

  // OPTIONAL Case 6 — listing-velocity burst (only with --with-burst).
  const burstProducts = [];
  if (withBurst) {
    for (let i = 0; i < BURST_PRODUCTS.length; i++) {
      const tpl = BURST_PRODUCTS[i];
      const key = getCacheKey(tpl.image, tpl.imageTransform);
      const buffer = imageCache[key];
      const hash = await perceptualHashFromBuffer(buffer);
      const mirrorHash = await mirrorPerceptualHashFromBuffer(buffer);
      const doc = buildProductDoc(
        tpl,
        usersByName[tpl.seller]._id,
        categoriesByName[tpl.category]._id,
        { url: `${BASE_URL}/public/seed-images/${tpl.image}` },
        hash,
        mirrorHash,
        new Date(now - (i + 1) * 60 * 1000) // within the last few minutes
      );
      const product = await Product.create(doc);
      burstProducts.push(product);
    }
    console.log(
      `[Seed] BURST demo products created (${burstProducts.length}) — CASE 6 (listing velocity)`
    );
  }

  // ── Sales (for priya trust score) ─────────────────────────────────────────
  const sales = [];
  const buyers = [arjun._id, meera._id, admin._id];
  for (let i = 0; i < 40; i++) {
    const product = priyaProducts[i % priyaProducts.length];
    const completedAt = new Date(now - (i + 1) * 9 * DAY_MS);
    const price = product.price - (i % 5) * 5;
    const sale = await Sale.create({
      product: product._id,
      seller: priya._id,
      buyer: buyers[i % buyers.length],
      salePrice: price,
      platformFee: Math.round(price * 0.05 * 100) / 100,
      netAmount: Math.round(price * 0.95 * 100) / 100,
      currencyCode: 'INR',
      status: 'completed',
      paymentStatus: 'paid',
      completedAt,
    });
    sales.push(sale);
  }
  console.log('[Seed] Created 40 sales for priya (trust-score sales component)');

  await Review.create([
    {
      seller: priya._id,
      buyer: meera._id,
      product: flask._id,
      sale: sales[0]._id,
      rating: 5,
      comment: 'Exactly as described — the flask keeps chai hot till evening, fast to respond, met up the same day. Would buy from Priya again without a second thought.',
    },
    {
      seller: priya._id,
      buyer: arjun._id,
      product: priyaProducts[1]._id,
      sale: sales[1]._id,
      rating: 4,
      comment: 'Smooth transaction and the iPhone was in great shape. Took a couple of days to reply to messages, but everything arrived as promised.',
    },
  ]);
  console.log('[Seed] Reviews created (2 verified reviews for priya)');

  const offer1 = await Offer.create({
    product: flask._id,
    buyer: arjun._id,
    seller: priya._id,
    amount: 480,
    message: 'Would you take 480 for the Milton flask?',
    status: 'countered',
    expiresAt: new Date(now + 6 * DAY_MS),
    history: [
      { status: 'pending', actor: arjun._id, at: new Date(now - 2 * DAY_MS), note: 'Initial offer' },
      { status: 'countered', actor: priya._id, at: new Date(now - 1 * DAY_MS), note: 'Countered with 500' },
    ],
  });
  const offer2 = await Offer.create({
    product: flask._id,
    buyer: arjun._id,
    seller: priya._id,
    amount: 500,
    message: 'I can do 500 if you include the original box.',
    status: 'pending',
    parentOffer: offer1._id,
    expiresAt: new Date(now + 6 * DAY_MS),
    history: [
      { status: 'pending', actor: priya._id, at: new Date(now - 1 * DAY_MS), note: 'Counter-offer sent' },
    ],
  });
  console.log('[Seed] Offers created (480 countered → 500 pending)');

  const convo = await Conversation.create({
    participants: [priya._id, arjun._id],
    product: flask._id,
    lastMessageAt: new Date(now - 2 * 3600 * 1000),
    unreadCounts: new Map([
      [priya._id.toString(), 3],
      [arjun._id.toString(), 0],
    ]),
  });
  const messages = [
    { sender: 'arjun', body: "Hi Priya! Is the Milton flask still available? Looking for a 1-litre steel bottle for my gym.", at: now - 26 * 3600 * 1000 },
    { sender: 'priya', body: 'Hey Arjun! Yes, it is. Vacuum seal is perfect, keeps chai hot for hours, and the cap threads smoothly.', at: now - 25 * 3600 * 1000 },
    { sender: 'arjun', body: 'Perfect. Would you consider 480? I can pick it up in person near Indiranagar.', at: now - 20 * 3600 * 1000 },
    { sender: 'priya', body: "I'd like to stay closer to 500 — it's genuinely leak-proof and I have another offer at 490.", at: now - 5 * 3600 * 1000 },
    { sender: 'arjun', body: 'Alright, 500 works for me. What time suits you this weekend to meet up?', at: now - 2 * 3600 * 1000 },
  ];
  const createdMessages = [];
  for (const m of messages) {
    const created = await Message.create({
      conversation: convo._id,
      sender: usersByName[m.sender]._id,
      content: m.body,
      type: 'text',
      status: 'read',
    });
    await Message.collection.updateOne({ _id: created._id }, { $set: { createdAt: new Date(m.at) } });
    createdMessages.push(created);
  }
  convo.lastMessage = createdMessages[createdMessages.length - 1]._id;
  await convo.save();
  console.log('[Seed] Conversation created (5 messages, priya ↔ arjun)');

  // ── Run detectRisk on all demo listings ────────────────────────────────────
  console.log('\n[Seed] Running detectRisk on duplicate-demo listings...');
  const allDemoAndDup = [...demoProducts, ...burstProducts];
  const riskTable = [];

  for (const listing of allDemoAndDup) {
    const freshDoc = await Product.findById(listing._id).lean();
    const risk = await detectRisk({
      product: freshDoc,
      hashes: freshDoc.aiAnalysis.imageHashes,
      aiAnalysis: freshDoc.aiAnalysis,
    });
    await Product.updateOne(
      { _id: listing._id },
      {
        $set: {
          'aiAnalysis.riskAssessment': {
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel,
            factors: risk.factors,
            riskFactorCategories: risk.riskFactorCategories,
            v1RiskScore: risk.riskScore,
            fusionMode: 'v1',
            assessedAt: new Date(),
          },
        },
      }
    );
    const caseLabel = freshDoc.title.match(/CASE (\d)/)?.[0] || '?';
    riskTable.push({
      case: caseLabel,
      title: freshDoc.title.substring(0, 45),
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      factors: risk.factors.join('; ') || '(none)',
    });
  }

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         DUPLICATE DETECTION DEMO — Risk Assessment Table                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  // Note about Redis requirement
  const redisAvailable = await (async () => {
    try {
      const { connection } = require('../src/queues');
      if (connection && connection.status === 'ready') return true;
    } catch {}
    return false;
  })();

  if (!redisAvailable) {
    console.log('⚠  NOTE: Redis/BullMQ workers are NOT running. The riskScore below is from');
    console.log('   detectRisk() (pHash + pricing heuristics). Full CNN/CLIP signals require');
    console.log('   the imageProcessor worker (npm run worker) with Redis.\n');
  }

  console.log('Case     | Title                                          | Score | Level  | Factors fired');
  console.log('---------|------------------------------------------------|-------|--------|------------------');
  for (const row of riskTable) {
    const c = row.case.padEnd(8);
    const t = row.title.substring(0, 46).padEnd(46);
    const s = String(row.riskScore).padEnd(5);
    const l = row.riskLevel.padEnd(6);
    console.log(`${c} | ${t} | ${s} | ${l} | ${row.factors.substring(0, 60)}`);
  }
  console.log('');

  // ── Full worker pass: EVERY listing through the image pipeline ────────────
  // Redis + ML reachability are verified first — STOP (non-zero exit) if not.
  await enqueueFullWorkerPass([...products, ...demoProducts, ...burstProducts]);

  // ── Per-product verification table ─────────────────────────────────────────
  await printCatalogTable([...products, ...demoProducts]);

  console.log('\n[Seed] Done! Demo credentials (password for all users):');
  console.log('  ' + PASSWORD);
  console.log('──────────────────────────────────────────────');
  for (const [name, u] of Object.entries(usersByName)) {
    console.log(`  ${name.padEnd(6)} ${u.email.padEnd(22)} ${u.role}`);
  }
  console.log('──────────────────────────────────────────────');
  console.log(`[Seed] Real product images served from ${IMAGES_DIR}`);

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
