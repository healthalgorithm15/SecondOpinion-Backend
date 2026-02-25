const multer = require('multer');

const fileFilter = (req, file, cb) => {
  // 💡 Debug: See what the phone is actually sending
  console.log("Incoming File MimeType:", file.mimetype);

  if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    // This tells multer to reject the file
    cb(null, false); 
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter, // 🛡️ FIX: You were missing this line!
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

module.exports = upload;