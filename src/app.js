const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middlewares/errorHandler');
const { globalLimiter } = require('./middlewares/rateLimiter');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply global rate limiting to all requests
app.use(globalLimiter);

// Basic health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Define Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/papers', require('./routes/paperRoutes'));
app.use('/api/chats', require('./routes/chatRoutes'));
app.use('/api/progress', require('./routes/progressRoutes'));

// Global Error Handler
app.use(errorHandler);

module.exports = app;
