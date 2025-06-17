const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory for processing
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  }
});

module.exports = {
  uploadSingle: (fieldName) => {
    return upload.single(fieldName);
  },
  uploadMultiple: (fieldName) => {
    return upload.array(fieldName, 10); // Limit to 10 files
  },
  uploadFields: (fields) => {
    return upload.fields(fields);
  }
};
