const User = require('../models/User');

// @desc    Register a new user or login existing (handled by Firebase on frontend)
// @route   POST /api/users/sync
// @access  Private (Needs Firebase Token)
const syncUser = async (req, res, next) => {
  try {
    const { uid, email } = req.user;
    const { name, role, profilePicture } = req.body;

    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // Create new user if they don't exist in MongoDB yet
      user = await User.create({
        firebaseUid: uid,
        email,
        name: name || 'Anonymous User',
        role: role || 'student',
        profilePicture,
      });
      return res.status(201).json(user);
    }

    // User exists, return user
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (user) {
      res.json(user);
    } else {
      res.status(404);
      throw new Error('User not found');
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  syncUser,
  getUserProfile,
};
