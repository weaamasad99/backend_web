const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// Configure Cloudinary from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a PDF file buffer to Cloudinary.
 * We upload as resource_type 'image' with format 'pdf' so that Cloudinary
 * serves the PDF file directly inline in browser iframes.
 * @param {Buffer} buffer - File buffer from Multer
 * @param {string} originalName - Original filename
 * @returns {Promise<object>} Cloudinary upload result
 */
const uploadPDFToCloudinary = (buffer, originalName) => {
  return new Promise((resolve, reject) => {
    // Generate a unique public ID under the "ResearchAI" folder
    const cleanName = originalName
      .replace(/\.[^/.]+$/, "") // remove extension
      .replace(/[^a-zA-Z0-9_-]/g, "_"); // sanitize characters
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        format: 'pdf',
        folder: 'ResearchAI',
        public_id: `${Date.now()}_${cleanName}`,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary Upload Stream Error:', error);
          return reject(error);
        }
        resolve(result);
      }
    );

    // Convert Buffer to Readable Stream and pipe to Cloudinary
    const stream = new Readable();
    stream._read = () => {};
    stream.push(buffer);
    stream.push(null);
    stream.pipe(uploadStream);
  });
};

module.exports = {
  uploadPDFToCloudinary,
  cloudinary,
};
