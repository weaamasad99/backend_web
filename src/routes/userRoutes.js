const express = require('express');
const router = express.Router();
const { loginUser, registerUser, getUserProfile, forgotPassword, updateUserProfile, getStudents } = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');

// Route: /api/users
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/forgot-password', authLimiter, forgotPassword);
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);
router.get('/students', protect, getStudents);

module.exports = router;
