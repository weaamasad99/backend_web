const { getAuth } = require('firebase-admin/auth');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token with Firebase
      const decodedToken = await getAuth().verifyIdToken(token);

      // Attach user info to request (from Firebase token)
      // Normally you would also find the user in MongoDB here:
      // const User = require('../models/User');
      // req.user = await User.findOne({ firebaseUid: decodedToken.uid });
      
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        // ...other claims
      };

      next();
    } catch (error) {
      console.error('Not authorized, token failed:', error.message);
      res.status(401);
      throw new Error('Not authorized, token failed');
    }
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }
};

module.exports = { protect };
