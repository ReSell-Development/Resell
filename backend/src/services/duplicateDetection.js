/**
 * Duplicate Detection Service - 3-Layer Optimization
 * 
 * Layer 1 (10ms): Perceptual Hash - Quick filter
 * Layer 2 (2s): CNN Features - Semantic matching
 * Layer 3 (500ms): SIFT Keypoints - Final verification
 */

const axios = require('axios');
const Product = require('../models/Product');
const { perceptualHashFromBuffer, hammingDistance, similarity } = require('./imageHash');
const { downloadImageBuffer } = require('./imageUtils');

class DuplicateDetector {
  constructor() {
    this.mlServiceUrl = process.env.ML_SERVICE_URL || 'http://localhost:5000';
    this.hashThreshold = parseInt(process.env.HASH_THRESHOLD || '8', 10);
    this.cnnThreshold = parseFloat(process.env.CNN_SIMILARITY_THRESHOLD || '0.75');
    this.siftThreshold = parseFloat(process.env.SIFT_THRESHOLD || '0.3');
    this.timeout = parseInt(process.env.DUPLICATE_CHECK_TIMEOUT || '10000', 10);
    
    // In-memory cache for CNN features (key: productId)
    this.cnnCache = new Map();
    this.cacheMaxSize = 1000;
    
    // Axios instance with timeout
    this.mlClient = axios.create({
      baseURL: this.mlServiceUrl,
      timeout: this.timeout,
    });
  }

  /**
   * Main detection method - orchestrates all 3 layers
   * @param {string} imageUrl - URL of the new image to check
   * @param {Object} metadata - Product metadata (category, price, etc.)
   * @param {string} sellerId - ID of the seller
   * @returns {Object} Detection result
   */
  async detectDuplicate(imageUrl, metadata, sellerId) {
    const startTime = Date.now();
    const timings = {};

    try {
      // STAGE 1: Perceptual Hash (Layer 1)
      const stage1Start = Date.now();
      const stage1Result = await this.stage1_perceptualHash(imageUrl, metadata.category);
      timings.stage1_ms = Date.now() - stage1Start;

      if (!stage1Result.candidates.length) {
        return this._buildResult(false, 0, 'perceptual_hash', timings, Date.now() - startTime);
      }

      // Filter out same seller's listings
      const otherSellerCandidates = stage1Result.candidates.filter(
        c => c.sellerId.toString() !== sellerId.toString()
      );

      if (!otherSellerCandidates.length) {
        return this._buildResult(false, 0, 'perceptual_hash', timings, Date.now() - startTime, {
          note: 'Only same-seller matches found (re-listing allowed)'
        });
      }

      // Check for exact match (Hamming distance = 0)
      const exactMatch = otherSellerCandidates.find(c => c.hammingDistance === 0);
      if (exactMatch) {
        timings.total_ms = Date.now() - startTime;
        return this._buildResult(
          true, 
          1.0, 
          'perceptual_hash_exact', 
          timings, 
          timings.total_ms,
          { 
            existingListingId: exactMatch._id,
            hammingDistance: 0,
            confidence: 1.0
          }
        );
      }

      // Get close matches (Hamming distance 1-8)
      const closeMatches = otherSellerCandidates.filter(c => c.hammingDistance <= this.hashThreshold);
      if (!closeMatches.length) {
        return this._buildResult(false, 0, 'perceptual_hash', timings, Date.now() - startTime);
      }

      // STAGE 2: CNN Features (Layer 2)
      const stage2Start = Date.now();
      const stage2Result = await this.stage2_cnnFeatures(imageUrl, closeMatches.slice(0, 5));
      timings.stage2_ms = Date.now() - stage2Start;

      if (!stage2Result.bestMatch) {
        return this._buildResult(false, 0, 'cnn_features', timings, Date.now() - startTime);
      }

      const { bestMatch, confidence } = stage2Result;

      // High confidence CNN match (>85%) - duplicate confirmed
      if (confidence >= 0.85) {
        timings.total_ms = Date.now() - startTime;
        return this._buildResult(
          true,
          confidence,
          'cnn_features_high_confidence',
          timings,
          timings.total_ms,
          { existingListingId: bestMatch._id, cnnSimilarity: confidence }
        );
      }

      // Medium confidence (60-85%) - need SIFT verification
      if (confidence >= 0.60) {
        // STAGE 3: SIFT Verification (Layer 3)
        const stage3Start = Date.now();
        const stage3Result = await this.stage3_siftVerification(imageUrl, bestMatch);
        timings.stage3_ms = Date.now() - stage3Start;

        if (stage3Result.match_score >= this.siftThreshold) {
          // Combine CNN and SIFT confidence
          const combinedConfidence = (confidence * 0.6) + (stage3Result.match_score * 0.4);
          timings.total_ms = Date.now() - startTime;
          return this._buildResult(
            true,
            combinedConfidence,
            'cnn_sift_combined',
            timings,
            timings.total_ms,
            { 
              existingListingId: bestMatch._id, 
              cnnSimilarity: confidence,
              siftScore: stage3Result.match_score
            }
          );
        }
      }

      // Low confidence or SIFT failed - not a duplicate
      timings.total_ms = Date.now() - startTime;
      return this._buildResult(false, 0, 'cnn_features', timings, timings.total_ms, {
        bestCnnMatch: bestMatch._id,
        cnnSimilarity: confidence
      });

    } catch (error) {
      console.error('[DuplicateDetector] Error:', error.message);
      timings.total_ms = Date.now() - startTime;
      // Graceful failure - don't block upload
      return this._buildResult(false, 0, 'error', timings, timings.total_ms, {
        error: error.message
      });
    }
  }

  /**
   * Stage 1: Perceptual Hash Comparison
   * Fast filtering using 64-bit pHash
   */
  async stage1_perceptualHash(imageUrl, category) {
    try {
      // Download image
      const imageBuffer = await downloadImageBuffer(imageUrl);
      
      // Generate perceptual hash
      const newHash = await perceptualHashFromBuffer(imageBuffer);

      // Build query for candidates
      const candidateFilter = {
        status: { $in: ['active', 'sold'] },
        'aiAnalysis.imageHashes': { $exists: true, $ne: [] },
      };

      if (category) {
        candidateFilter.category = category;
      }

      // Query for candidates with hashes.
      // `images` is selected so Stage 2 (CNN features) can fetch each
      // candidate's primary image URL — without it the CNN layer can
      // never run.
      const candidates = await Product.find(candidateFilter)
        .select('_id seller aiAnalysis.imageHashes images title')
        .limit(500)
        .lean();

      // Calculate Hamming distances
      const results = [];
      for (const candidate of candidates) {
        const candidateHashes = candidate.aiAnalysis?.imageHashes || [];
        let minDistance = 64;
        let minHash = null;

        for (const candidateHash of candidateHashes) {
          const distance = hammingDistance(newHash, candidateHash);
          if (distance < minDistance) {
            minDistance = distance;
            minHash = candidateHash;
          }
        }

        if (minDistance <= this.hashThreshold) {
          results.push({
            _id: candidate._id,
            sellerId: candidate.seller,
            title: candidate.title,
            hammingDistance: minDistance,
            // Similarity of the CLOSEST matching hash, not the first stored one
            hashSimilarity: minHash ? similarity(newHash, minHash) : 0,
          });
        }
      }

      // Sort by distance (closest first)
      results.sort((a, b) => a.hammingDistance - b.hammingDistance);

      return { candidates: results, newHash };
    } catch (error) {
      console.error('[DuplicateDetector] Stage 1 error:', error.message);
      throw error;
    }
  }

  /**
   * Stage 2: CNN Feature Comparison
   * Semantic matching using MobileNetV2 features
   */
  async stage2_cnnFeatures(imageUrl, candidates) {
    try {
      // Extract CNN features for new image
      const newFeatures = await this.extractCNNFeatures(imageUrl);
      if (!newFeatures || !newFeatures.features.length) {
        return { bestMatch: null, confidence: 0 };
      }

      let bestMatch = null;
      let bestConfidence = 0;

      // Compare with top candidates (max 5)
      for (const candidate of candidates) {
        // Try to get cached features
        let candidateFeatures = this.cnnCache.get(candidate._id.toString());
        
        if (!candidateFeatures) {
          // Extract features from candidate's primary image
          const primaryImage = candidate.images?.[0]?.url;
          if (primaryImage) {
            try {
              candidateFeatures = await this.extractCNNFeatures(primaryImage);
              if (candidateFeatures?.features?.length) {
                // Cache for future use
                if (this.cnnCache.size >= this.cacheMaxSize) {
                  const firstKey = this.cnnCache.keys().next().value;
                  this.cnnCache.delete(firstKey);
                }
                this.cnnCache.set(candidate._id.toString(), candidateFeatures);
              }
            } catch (e) {
              console.warn(`[DuplicateDetector] Failed to extract features for ${candidate._id}:`, e.message);
            }
          }
        }

        if (candidateFeatures?.features?.length) {
          const cnnSim = this.cosineSimilarity(newFeatures.features, candidateFeatures.features);
          
          if (cnnSim > bestConfidence) {
            bestConfidence = cnnSim;
            bestMatch = candidate;
          }
        }
      }

      return { bestMatch, confidence: bestConfidence };
    } catch (error) {
      console.error('[DuplicateDetector] Stage 2 error:', error.message);
      return { bestMatch: null, confidence: 0 };
    }
  }

  /**
   * Stage 3: SIFT Keypoint Verification
   * Geometric verification for final confirmation
   */
  async stage3_siftVerification(newImageUrl, candidate) {
    try {
      const candidateImageUrl = candidate.images?.[0]?.url;
      if (!candidateImageUrl) {
        return { match_score: 0 };
      }

      const response = await this.mlClient.post('/verify-sift', {
        newImageUrl,
        candidateImageUrl,
      });

      return response.data;
    } catch (error) {
      console.error('[DuplicateDetector] Stage 3 error:', error.message);
      return { match_score: 0 };
    }
  }

  /**
   * Extract CNN features via ML service
   */
  async extractCNNFeatures(imageUrl) {
    try {
      const response = await this.mlClient.post('/extract-cnn', { imageUrl });
      return response.data;
    } catch (error) {
      console.error('[DuplicateDetector] CNN extraction error:', error.message);
      return null;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Build standardized result object
   */
  _buildResult(isDuplicate, confidence, detectionMethod, timings, totalMs, extra = {}) {
    return {
      isDuplicate,
      confidence: Math.round(confidence * 10000) / 10000,
      detectionMethod,
      processingTimeMs: totalMs,
      stageTimings: timings,
      timestamp: new Date().toISOString(),
      ...extra
    };
  }

  /**
   * Clear the CNN cache
   */
  clearCache() {
    this.cnnCache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      size: this.cnnCache.size,
      maxSize: this.cacheMaxSize
    };
  }
}

// Singleton instance
const duplicateDetector = new DuplicateDetector();

module.exports = { duplicateDetector, DuplicateDetector };