/**
 * Cloudinary Utility - Re-exports from config
 */

const { 
  uploadToCloudinary, 
  deleteFromCloudinary, 
  isConfigured,
  cloudinary 
} = require('../config/cloudinary');

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  isConfigured,
  cloudinary,
};