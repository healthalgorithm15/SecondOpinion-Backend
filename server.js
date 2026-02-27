const config = require('./config'); 
const cors = require('cors');
const express = require('express');
const http = require('http'); // 🟢 Added for WebSockets
const { Server } = require('socket.io'); // 🟢 Added
const connectDB = require('./config/db');
const User = require('./models/User');

// Route Imports
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const reportRoutes = require('./routes/reportRoutes');

// Connect to Database
connectDB();

const app = express();

// 🟢 1. Create HTTP Server
const server = http.createServer(app);

// 🟢 2. Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // In production, replace with your frontend URL
    methods: ["GET", "POST"]
  }
});

// 🟢 3. Make 'io' globally accessible to your controllers
// This allows you to call global.io.emit() inside your routes
global.io = io;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/reports', reportRoutes);

// 🟢 4. Basic Socket Connection Logic
io.on('connection', (socket) => {
  console.log('⚡ New Connection:', socket.id); 

  // This event "links" the socket to the logged-in user
  socket.on('joinRoom', async (data) => {
    const { userId, role } = data; // Data from frontend
    
    socket.join(role);
    console.log(`👤 User ${userId} joined room: ${role}`);

    // 🟢 UPDATE DATABASE: Save the socketId to the User document
    if (userId) {
      try {
        await User.findByIdAndUpdate(userId, { socketId: socket.id });
        console.log(`✅ DB Success: Linked Socket ${socket.id} to User ${userId}`);
      } catch (err) {
        console.error('❌ DB Update Error:', err);
      }
    }
  });

  socket.on('disconnect', async () => {
    // 🔴 CLEANUP: Clear the socketId when they go offline
    await User.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
    console.log('🔌 User disconnected');
  });
});

const PORT = config.port;

// 🟢 5. CRITICAL: Change app.listen to server.listen
server.listen(PORT, () => {
  console.log(`🚀 Server running in ${config.env} mode on port ${PORT}`);
  console.log(`📡 WebSockets enabled`);
});