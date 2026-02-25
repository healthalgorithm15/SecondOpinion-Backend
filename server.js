const config = require('./config'); 
const cors = require('cors');
const express = require('express');
const connectDB = require('./config/db');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes'); // 👈 1. Import Auth Routes
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const reportRoutes = require('./routes/reportRoutes')


// Connect to Database
connectDB();


const app = express();
app.use(cors());

// Middleware
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);   // 👈 2. Mount Auth Routes at /api/auth
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/reports', reportRoutes);

const PORT = config.port;
app.listen(PORT, () => console.log(`🚀 Server running in ${config.env} mode on port ${PORT}`));