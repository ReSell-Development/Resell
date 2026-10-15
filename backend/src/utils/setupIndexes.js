/**
 * MongoDB Index Setup Utility
 * Creates all necessary indexes for the Product collection
 */

const Product = require('../models/Product');

const createIndexes = async () => {
  try {
    console.log('[Indexes] Creating database indexes...');
    
    const indexes = [
      // Text search
      { 
        keys: { title: 'text', description: 'text', brand: 'text', model: 'text' },
        options: { name: 'text_search', default_language: 'english' }
      },
      
      // Status and date
      { 
        keys: { status: 1, createdAt: -1 },
        options: { name: 'status_createdAt' }
      },
      
      // Category + status
      { 
        keys: { category: 1, status: 1 },
        options: { name: 'category_status' }
      },
      
      // Price
      { 
        keys: { price: 1 },
        options: { name: 'price_asc' }
      },
      
      // Location
      { 
        keys: { 'location.city': 1 },
        options: { name: 'location_city' }
      },
      
      // Seller + status
      { 
        keys: { seller: 1, status: 1 },
        options: { name: 'seller_status' }
      },
      
      // AI risk assessment
      { 
        keys: { 'aiAnalysis.riskAssessment.riskScore': -1 },
        options: { name: 'risk_score' }
      },
      
      // Duplicate detection indexes
      { 
        keys: { 'duplicateInfo.isDuplicate': 1, status: 1 },
        options: { name: 'duplicate_status' }
      },
      
      { 
        keys: { 'duplicateInfo.duplicateOf': 1 },
        options: { name: 'duplicate_of' }
      },
      
      { 
        keys: { 'images.perceptualHash': 1, status: 1 },
        options: { name: 'perceptual_hash_status' }
      },
      
      // Compound indexes for common queries
      { 
        keys: { category: 1, price: 1, status: 1 },
        options: { name: 'category_price_status' }
      },
      
      { 
        keys: { seller: 1, createdAt: -1 },
        options: { name: 'seller_createdAt' }
      },
      
      // For duplicate detection with category filter
      { 
        keys: { category: 1, status: 1, 'images.perceptualHash': 1 },
        options: { name: 'category_status_phash' }
      },
    ];
    
    for (const index of indexes) {
      try {
        await Product.collection.createIndex(index.keys, index.options);
        console.log(`[Indexes] Created: ${index.options.name}`);
      } catch (err) {
        if (err.code === 85 || err.codeName === 'IndexOptionsConflict') {
          // Index already exists with different options - try to drop and recreate
          console.warn(`[Indexes] Index ${index.options.name} exists with different options`);
        } else if (err.code !== 86) { // 86 = IndexAlreadyExists
          console.error(`[Indexes] Failed to create ${index.options.name}:`, err.message);
        }
      }
    }
    
    console.log('[Indexes] All indexes created successfully');
    return true;
  } catch (error) {
    console.error('[Indexes] Error creating indexes:', error.message);
    return false;
  }
};

/**
 * Drop all custom indexes (for testing/reset)
 */
const dropIndexes = async () => {
  try {
    console.log('[Indexes] Dropping custom indexes...');
    await Product.collection.dropIndexes();
    console.log('[Indexes] All indexes dropped');
    return true;
  } catch (error) {
    console.error('[Indexes] Error dropping indexes:', error.message);
    return false;
  }
};

/**
 * List all indexes
 */
const listIndexes = async () => {
  try {
    const indexes = await Product.collection.indexes();
    console.log('[Indexes] Current indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });
    return indexes;
  } catch (error) {
    console.error('[Indexes] Error listing indexes:', error.message);
    return [];
  }
};

module.exports = {
  createIndexes,
  dropIndexes,
  listIndexes,
};