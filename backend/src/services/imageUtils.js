/**
 * Image Utilities - Download and process images
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Download image as buffer with timeout
 * @param {string} imageUrl - URL of the image
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Buffer>} Image buffer
 */
const downloadImageBuffer = (imageUrl, timeoutMs = 5000) => {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(imageUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const req = client.get(imageUrl, { 
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ReSell/1.0)'
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Image download timeout'));
      });
      
      req.on('error', reject);
      
      req.setTimeout(timeoutMs);
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Validate image buffer
 * @param {Buffer} buffer - Image buffer
 * @returns {Object} Validation result
 */
const validateImageBuffer = (buffer) => {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty buffer' };
  }
  
  // Check file signature (magic bytes)
  const signatures = {
    jpeg: [0xFF, 0xD8, 0xFF],
    png: [0x89, 0x50, 0x4E, 0x47],
    gif: [0x47, 0x49, 0x46, 0x38],
    webp: [0x52, 0x49, 0x46, 0x46], // RIFF
  };
  
  for (const [format, sig] of Object.entries(signatures)) {
    if (buffer.length >= sig.length) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        return { valid: true, format };
      }
    }
  }
  
  return { valid: false, error: 'Invalid image format' };
};

/**
 * Get image dimensions from buffer (without sharp)
 * @param {Buffer} buffer - Image buffer
 * @returns {Object} Width and height
 */
const getImageDimensions = (buffer) => {
  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    for (let i = 2; i < buffer.length - 8; i++) {
      if (buffer[i] === 0xFF && (buffer[i + 1] === 0xC0 || buffer[i + 1] === 0xC2)) {
        const height = (buffer[i + 5] << 8) + buffer[i + 6];
        const width = (buffer[i + 7] << 8) + buffer[i + 8];
        return { width, height };
      }
    }
  }
  
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
    const height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
    return { width, height };
  }
  
  return { width: 0, height: 0 };
};

/**
 * Extract color histogram from image buffer (using sharp if available)
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<Array<number>>} Color histogram
 */
const extractColorHistogram = async (buffer) => {
  try {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      sharp = null;
    }
    
    if (sharp) {
      const { data } = await sharp(buffer)
        .resize(64, 64, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Simple 16-bin RGB histogram (48 bins total)
      const histogram = new Array(48).fill(0);
      for (let i = 0; i < data.length; i += 3) {
        const r = Math.floor(data[i] / 16);
        const g = Math.floor(data[i + 1] / 16);
        const b = Math.floor(data[i + 2] / 16);
        histogram[r]++;
        histogram[16 + g]++;
        histogram[32 + b]++;
      }
      
      // Normalize
      const total = data.length / 3;
      return histogram.map(v => v / total);
    }
    
    return new Array(48).fill(0);
  } catch (error) {
    console.error('[ImageUtils] Color histogram extraction failed:', error.message);
    return new Array(48).fill(0);
  }
};

/**
 * Compress image buffer
 * @param {Buffer} buffer - Image buffer
 * @param {Object} options - Compression options
 * @returns {Promise<Buffer>} Compressed buffer
 */
const compressImage = async (buffer, options = {}) => {
  try {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      sharp = null;
    }
    
    if (sharp) {
      const width = options.width || 1200;
      const height = options.height || 1200;
      const quality = options.quality || 80;
      
      return await sharp(buffer)
        .resize(width, height, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
    }
    
    return buffer;
  } catch (error) {
    console.error('[ImageUtils] Compression failed:', error.message);
    return buffer;
  }
};

module.exports = {
  downloadImageBuffer,
  validateImageBuffer,
  getImageDimensions,
  extractColorHistogram,
  compressImage,
};