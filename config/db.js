// Change this line:
const config = require('../config'); // Use '../' to go up and find the config folder
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Use the URI from your centralized config object
    console.log("Mongo uri",config.db.uri);
    const conn = await mongoose.connect(config.db.uri, { 
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
      autoIndex: config.env !== 'production',
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`❌ Initial Connection Error: ${err.message}`);
    process.exit(1);
  }
};

// ... keep the rest of your reconnection logic ...
module.exports = connectDB;





