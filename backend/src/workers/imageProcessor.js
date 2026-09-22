const { Worker } = require('bullmq');
const { connection } = require('../queues');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { perceptualHashFromBuffer } = require('../services/imageHash');
const { createCVProvider } = require('../services/cvAdapter');
const { extractColorHistogram, downloadImageBuffer } = require('../services/imageUtils');
const cvProvider = createCVProvider();
const { calculateRecommendedPrice } = require('../services/priceRecommendation');
const { detectRisk } = require('../services/fraudDetection');

const imageProcessingWorker = new Worker(
  'image-processing',
  async (job) => {
    const { productId, images, productData } = job.data;

    try {
      console.log(`[Worker] Processing images for product ${productId}`);

      const results = [];
      for (const image of images) {
        let buffer;
        if (image.buffer) {
          buffer = Buffer.from(image.buffer);
        } else if (image.url) {
          const res = await fetch(image.url);
          if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
          buffer = Buffer.from(await res.arrayBuffer());
        } else {
          throw new Error('No image buffer or URL provided');
        }

        // Images were already uploaded to Cloudinary during the request.
        // Reuse the existing URL/publicId instead of uploading again.
        const hash = await perceptualHashFromBuffer(buffer);
        
        // Extract color histogram
        const colorHistogram = await extractColorHistogram(buffer);

        const [condition, damage, classification] = await Promise.all([
          cvProvider.assessCondition(buffer),
          cvProvider.detectDamage(buffer),
          cvProvider.classifyProduct(buffer, {
            filename: image.originalname || 'image.jpg',
            title: productData.title,
          }),
        ]);

        results.push({
          url: image.url,
          publicId: image.publicId,
          hash,
          colorHistogram,
          analysis: {
            conditionScore: condition.score,
            damageScore: damage.score,
            predictedCategory: classification.category,
            classificationConfidence: classification.confidence,
          },
        });
      }

      if (results.length === 0) {
        throw new Error('No images processed successfully');
      }

      const avgCondition =
        results.reduce((s, r) => s + (r.analysis?.conditionScore || 0), 0) / results.length;
      const avgDamage =
        results.reduce((s, r) => s + (r.analysis?.damageScore || 0), 0) / results.length;
      const predictedCategory = results[0]?.analysis?.predictedCategory || 'Other';

      const category = await Category.findById(productData.category);
      const comparables = await Product.find({
        category: productData.category,
        status: 'sold',
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('price condition brand model');

      const priceRec = await calculateRecommendedPrice({
        category,
        brand: productData.brand,
        model: productData.model,
        originalPrice: productData.originalPrice,
        yearsUsed: productData.yearsUsed,
        condition: productData.condition,
        cvConditionScore: Math.round(avgCondition),
        damageScore: Math.round(avgDamage),
        specifications: productData.specifications,
        comparableListings: comparables,
      });

      const product = await Product.findByIdAndUpdate(
        productId,
        {
          images: results.map((r, idx) => ({
            url: r.url,
            publicId: r.publicId,
            isPrimary: idx === 0,
            perceptualHash: r.hash,
            colorHistogram: r.colorHistogram,
            productType: 'unknown', // Will be filled by ML service if needed
          })),
          aiAnalysis: {
            classification: {
              predictedCategory,
              confidence: results[0]?.analysis?.classificationConfidence || 0,
            },
            conditionScore: Math.round(avgCondition),
            damageScore: Math.round(avgDamage),
            damageDescription: '',
            imageHashes: results.map((r) => r.hash).filter(Boolean),
            priceRecommendation: {
              recommendedPrice: priceRec.recommendedPrice,
              minPrice: priceRec.minPrice,
              maxPrice: priceRec.maxPrice,
              confidence: priceRec.confidence,
              explanation: priceRec.explanation,
              factors: priceRec.factors,
              source: priceRec.source,
              generatedAt: new Date(),
            },
            lastAnalyzedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!product) {
        throw new Error('Product not found');
      }

      // Extract CNN features for duplicate detection (async, non-blocking)
      // This is done in background to not slow down the worker
      setImmediate(async () => {
        try {
          const axios = require('axios');
          const mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:5000';
          const mlClient = axios.create({ baseURL: mlServiceUrl, timeout: 15000 });
          
          for (const image of images) {
            if (image.url) {
              try {
                const response = await mlClient.post('/extract-cnn', { imageUrl: image.url });
                if (response.data?.features?.length) {
                  // Update product with CNN features
                  await Product.findByIdAndUpdate(productId, {
                    $set: {
                      'images.$[elem].cnnFeatures': response.data.features,
                      'images.$[elem].productType': response.data.product_type || 'unknown',
                    },
                  }, {
                    arrayFilters: [{ 'elem.url': image.url }],
                  });
                }
              } catch (e) {
                console.warn(`[Worker] CNN extraction failed for ${image.url}:`, e.message);
              }
            }
          }
        } catch (e) {
          console.warn('[Worker] Background CNN extraction failed:', e.message);
        }
      });

      const risk = await detectRisk({
        product,
        hashes: product.aiAnalysis.imageHashes,
        aiAnalysis: product.aiAnalysis,
      });

      product.aiAnalysis.riskAssessment = {
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        factors: risk.factors,
        assessedAt: new Date(),
      };

      await product.save();

      try {
        const { priceAnalysisQueue } = require('../queues');
        await priceAnalysisQueue.add('reprice', { productId }, { delay: 30000 });
      } catch (err) {
        console.warn(`[Worker] Could not enqueue price-analysis job for ${productId}: ${err.message}`);
      }

      console.log(`[Worker] Completed processing for product ${productId}`);
      return { success: true, productId };
    } catch (error) {
      console.error(`[Worker] Error processing product ${productId}:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

imageProcessingWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

imageProcessingWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

console.log('[Worker] Image processing worker started');

process.on('SIGINT', async () => {
  console.log('[Worker] Shutting down...');
  await imageProcessingWorker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down...');
  await imageProcessingWorker.close();
  process.exit(0);
});