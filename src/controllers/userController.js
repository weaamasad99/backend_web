const User = require('../models/User');
const Paper = require('../models/Paper');
const Chat = require('../models/Chat');
const { getAuth } = require('firebase-admin/auth');
const axios = require('axios');

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res, next) => {
  try {
    const { email, username, password, name, role, institution } = req.body;

    if (!email || !username || !password || !name) {
      res.status(400);
      throw new Error('Please provide all required fields (email, username, password, name)');
    }

    // Check if username already exists in MongoDB
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      res.status(400);
      throw new Error('Username is already taken');
    }

    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: name,
    });

    // 2. Save user in MongoDB
    const user = await User.create({
      firebaseUid: userRecord.uid,
      username: username,
      email: userRecord.email,
      name: userRecord.displayName || name,
      role: role || 'student', // default role
      institution: institution || '',
    });

    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      res.status(400);
      throw new Error('Please provide email/username and password');
    }

    let loginEmail = identifier;

    // Check if identifier is a username (doesn't contain '@')
    if (!identifier.includes('@')) {
      const userDoc = await User.findOne({ username: identifier });
      if (!userDoc) {
        res.status(404);
        throw new Error('User not found');
      }
      loginEmail = userDoc.email;
    }

    // 1. Authenticate with Firebase REST API
    const apiKey = process.env.FIREBASE_API_KEY;
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    let response;
    try {
      response = await axios.post(authUrl, {
        email: loginEmail,
        password,
        returnSecureToken: true
      });
    } catch (err) {
      res.status(401);
      throw new Error('Invalid email/username or password');
    }

    const { idToken, localId } = response.data;

    // 2. Fetch user from MongoDB
    const user = await User.findOne({ firebaseUid: localId });

    if (!user) {
      res.status(404);
      throw new Error('User not found in database');
    }

    res.status(200).json({
      token: idToken,
      user
    });
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

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (user) {
      user.name = req.body.name || user.name;
      user.institution = req.body.institution !== undefined ? req.body.institution : user.institution;

      const updatedUser = await user.save();
      res.json({
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } else {
      res.status(404);
      throw new Error('User not found');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Get all students for lecturer dashboard
// @route   GET /api/users/students
// @access  Private (Lecturer only)
const getStudents = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    
    if (!user || user.role !== 'lecturer') {
      res.status(403);
      throw new Error('Not authorized as a lecturer');
    }

    const students = await User.find({ role: 'student' }).select('-firebaseUid -__v');
    
    const studentData = await Promise.all(students.map(async (student) => {
      const papersCount = await Paper.countDocuments({ uploadedBy: student._id });
      const chats = await Chat.find({ student: student._id }).sort({ updatedAt: -1 }).limit(1);
      const lastActive = chats.length > 0 ? chats[0].updatedAt : student.updatedAt;

      // Format date
      const date = new Date(lastActive);
      const now = new Date();
      const diffMs = now - date;
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);
      let lastActiveStr = 'Just now';
      if (diffDays > 0) {
        lastActiveStr = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      } else if (diffHrs > 0) {
        lastActiveStr = `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
      }

      return {
        id: student._id,
        name: student.name,
        email: student.email,
        project: student.institution || 'Final Project',
        papersAnalyzed: papersCount,
        lastActive: lastActiveStr,
        status: papersCount > 0 ? 'Active' : 'Review Needed',
      };
    }));

    res.json(studentData);
  } catch (error) {
    next(error);
  }
};

// @desc    Forgot password
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      res.status(400);
      throw new Error('Please provide email or username');
    }

    let resetEmail = identifier;

    // If it's a username, find the email
    if (!identifier.includes('@')) {
      const userDoc = await User.findOne({ username: identifier });
      if (!userDoc) {
        res.status(404);
        throw new Error('User not found');
      }
      resetEmail = userDoc.email;
    }

    const apiKey = process.env.FIREBASE_API_KEY;
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;

    try {
      await axios.post(authUrl, {
        requestType: 'PASSWORD_RESET',
        email: resetEmail
      });
      res.status(200).json({ message: 'Password reset email sent successfully' });
    } catch (err) {
      res.status(500);
      throw new Error('Failed to send password reset email');
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  getStudents,
  forgotPassword,
};
