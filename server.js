const config = require('./config'); 
const cors = require('cors');
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const connectDB = require('./config/db');
const User = require('./models/User');

// Route Imports
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const reportRoutes = require('./routes/reportRoutes');

connectDB();

const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

// Initialize Socket.io with enhanced settings for Cloud Environments
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000, // Handle potential Azure idle timeouts
  pingInterval: 25000,
  transports: ['websocket', 'polling'] // Allow fallback if websocket fails
});

global.io = io;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: "Backend is officially LIVE",
    env: config.env 
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/reports', reportRoutes);

// Socket Logic
io.on('connection', (socket) => {
  console.log(`⚡ Connection Established: ${socket.id}`); 

  socket.on('joinRoom', async (data) => {
    const { userId, role } = data;
    
    if (role) {
      socket.join(role);
      console.log(`👤 User ${userId} (Role: ${role}) joined their room.`);
    }

    if (userId) {
      try {
        await User.findByIdAndUpdate(userId, { socketId: socket.id });
      } catch (err) {
        console.error('❌ Socket DB Link Error:', err);
      }
    }
  });

  socket.on('disconnect', async (reason) => {
    console.log(`🔌 Disconnected: ${socket.id} (Reason: ${reason})`);
    await User.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
  });
});

const PORT = config.port || 8080; // Azure typically injects a port, but 8080 is common for containers

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket Engine active`);
});