#!/usr/bin/env node

/** Requeue existing listings through the image-analysis worker. */
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const queues = require('../src/queues');

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0 || ids.some((id) => !mongoose.isValidObjectId(id))) {
    throw new Error('Usage: node scripts/reprocess_products.js <productId> [productId...]');
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) is required');
  await mongoose.connect(uri);
  await queues.whenConnected;

  const products = await Product.find({ _id: { $in: ids } }).lean();
  if (products.length !== ids.length) throw new Error('One or more product IDs were not found');

  for (const product of products) {
    await queues.imageProcessingQueue.add('analyze-product', {
      productId: product._id.toString(),
      images: (product.images || []).map((image) => ({
        url: image.url,
        publicId: image.publicId,
        hash: image.perceptualHash,
      })),
      productData: {
        title: product.title,
        description: product.description,
        price: product.price,
        originalPrice: product.originalPrice,
        category: product.category,
        brand: product.brand,
        model: product.model,
        condition: product.condition,
        yearsUsed: product.yearsUsed,
        specifications: product.specifications,
        location: product.location,
        seller: product.seller?.toString(),
      },
    });
    console.log(`Enqueued image analysis for ${product._id} (${product.title})`);
  }
}

main()
  .catch((error) => {
    console.error(`[reprocess_products] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

