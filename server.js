// 1. MUST BE FIRST: Load Environment Variables
require('dotenv').config(); 
const config = require('./config'); 

const cors = require('cors');
const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const connectDB = require('./config/db');
const User = require('./models/User');

// 2. Connect to Database
connectDB();

const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

// 3. Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000, 
  pingInterval: 25000,
  transports: ['websocket', 'polling'] 
});

global.io = io;

// 4. Middleware
app.use(cors());
app.use(express.json());

// 5. Route Imports (Moved AFTER dotenv/config)
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const patientRoutes = require('./routes/patientRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const reportRoutes = require('./routes/reportRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const reviewRoutes = require('./routes/reviewRoutes');

app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: "Praman AI Backend is LIVE",
    env: config.env 
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reviews', reviewRoutes);

// Socket Logic
io.on('connection', (socket) => {
  console.log(`⚡ Connection Established: ${socket.id}`); 
  socket.on('joinRoom', async (data) => {
    const { userId, role } = data;
    if (role) socket.join(role);
    if (userId) {
      try {
        await User.findByIdAndUpdate(userId, { socketId: socket.id });
      } catch (err) {
        console.error('❌ Socket DB Link Error:', err);
      }
    }
  });

  socket.on('disconnect', async () => {
    await User.findOneAndUpdate({ socketId: socket.id }, { socketId: null });
  });
});
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error"
  });
});
const PORT = process.env.PORT || 8080; 

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket Engine active`);
});