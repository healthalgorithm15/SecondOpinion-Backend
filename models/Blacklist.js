const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  token: { 
    type: String, 
    required: true, 
    index: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: '24h' // Automatically delete token from DB after 24 hours
  }
});

// Check if the model exists before exporting, or create a new one
module.exports = mongoose.models.Blacklist || mongoose.model('Blacklist', blacklistSchema);