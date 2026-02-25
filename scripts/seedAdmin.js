const mongoose = require('mongoose');
const User = require('../models/User'); 
const config = require('../config');
require('dotenv').config();

const seedSuperAdmin = async () => {
  try {
    await mongoose.connect(config.db.uri);
    
    const adminEmail = 'admin@pramanai.com';

    // 1. Clean up old/bad data (removes the one with the backtick or double-hash)
    await User.deleteMany({ email: adminEmail });

    // 2. Create using the Model
    // DO NOT hash the password here. Let the pre('save') hook in User.js do it!
    const superAdmin = new User({
      name: 'System Administrator',
      email: adminEmail,
      password: 'AdminPassword!', // 🟢 PLAIN TEXT HERE
      role: 'admin',
      isVerified: true,
      isEmailVerified: true,
      isProfileApproved: true,
      isFirstLogin: false,
      authMethod: 'local',
      consent: { hasAgreed: true, agreedAt: new Date() }
    });

    // 3. This trigger the .pre('save') middleware correctly
    await superAdmin.save();
    
    console.log(`✅ SUCCESS: Admin ${adminEmail} created and hashed correctly.`);
    process.exit(0);
  } catch (error) {
    console.error('❌ SEED ERROR:', error.message);
    process.exit(1);
  }
};

seedSuperAdmin();