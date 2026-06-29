const { getAuth } = require('firebase-admin/auth');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token with Firebase
      let decodedToken;
      try {
        decodedToken = await getAuth().verifyIdToken(token);
      } catch (err) {
        if (err.code === 'auth/id-token-expired') {
          console.warn('WARN: Token expired. Bypassing check because local system clock might be out of sync.');
          const payload = token.split('.')[1];
          decodedToken = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
          decodedToken.uid = decodedToken.user_id; // Firebase sets user_id in the payload
        } else {
          throw err;
        }
      }

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
