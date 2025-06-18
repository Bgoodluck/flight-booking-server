// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression'); 
const morgan = require('morgan'); // ADD THIS
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { ClerkExpressWithAuth } = require('@clerk/clerk-sdk-node');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware
app.use(helmet());
app.use(compression()); // ADD THIS - Compresses response bodies
app.use(morgan('combined')); // ADD THIS - HTTP request logger
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://elevatio-test-site.vercel.app',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Clerk authentication middleware
app.use(ClerkExpressWithAuth());

// Add this before your routes to see what's happening
app.use((req, res, next) => {
  console.log(`📍 ${req.method} ${req.path} - Auth header: ${req.headers.authorization ? 'Present' : 'Missing'}`);
  next();
});

// Routes

app.use('/api/flights', require('./routes/flightRoute'));
app.use('/api/bookings', require('./routes/bookingRoute'));
app.use('/api/users', require('./routes/userRoute'));
app.use('/api/partners', require('./routes/partnerRoute'));
app.use('/api/admin/auth', require('./routes/adminAuthRoute'));
app.use('/api/admin', require('./routes/adminRoute'));
app.use('/api/payments', require('./routes/paymentRoute'));
app.use('/commission', require('./routes/commission-fix'));


// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0' 
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.message
    });
  }
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }
  
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Elevatio API server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});

module.exports = app;