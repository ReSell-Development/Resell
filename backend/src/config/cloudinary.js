const cloudinary = require('cloudinary').v2;
const AppError = require('../utils/AppError');

let cloudinaryConfigured = false;

const validateCloudinaryConfig = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return false;
  }
  if (CLOUDINARY_CLOUD_NAME === 'demo' || CLOUDINARY_API_KEY === 'demo' || CLOUDINARY_API_SECRET === 'demo') {
    return false;
  }
  return true;
};

cloudinaryConfigured = validateCloudinaryConfig();

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} else {
  console.warn('[Cloudinary] Not configured or using demo credentials. Image uploads will fail. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env');
}

const uploadToCloudinary = (fileBuffer, folder = 'resell') => {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigured) {
      return reject(new AppError(
        'Cloudinary not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env with real credentials from https://cloudinary.com/console',
        500,
        'CLOUDINARY_NOT_CONFIGURED'
      ));
    }
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { quality: 'auto:good' },
          { fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) {
          const msg = error.message || 'Unknown Cloudinary error';
          if (msg.includes('Invalid API Key') || msg.includes('Invalid credentials')) {
            return reject(new AppError('Invalid Cloudinary credentials. Check your .env configuration.', 500, 'CLOUDINARY_INVALID_CREDS'));
          }
          if (msg.includes('Upload preset')) {
            return reject(new AppError('Cloudinary upload preset error. Check your Cloudinary settings.', 500, 'CLOUDINARY_PRESET_ERROR'));
          }
          return reject(new AppError(`Cloudinary upload failed: ${msg}`, 500, 'CLOUDINARY_UPLOAD_FAILED'));
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
        });
      }
    );
    uploadStream.end(fileBuffer);
  });
};

const deleteFromCloudinary = async (publicId) => {
  if (!cloudinaryConfigured) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('[Cloudinary] Delete error:', error.message);
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
  isConfigured: () => cloudinaryConfigured,
};
