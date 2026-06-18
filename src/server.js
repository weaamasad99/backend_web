require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { initializeFirebase } = require('./config/firebase');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize Firebase Admin (uncomment when keys are ready)
    initializeFirebase();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
