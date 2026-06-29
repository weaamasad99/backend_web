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
    const { email, password, name, role } = req.body;

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

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
};
