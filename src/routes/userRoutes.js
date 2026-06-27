const express = require('express');
const router = express.Router();
const { loginUser, registerUser, getUserProfile, updateUserProfile, getStudents } = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/users
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);
router.get('/students', protect, getStudents);

module.exports = router;
