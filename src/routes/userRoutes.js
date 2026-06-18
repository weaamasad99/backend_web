const express = require('express');
const router = express.Router();
const { syncUser, getUserProfile } = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/users
router.post('/sync', protect, syncUser);
router.get('/profile', protect, getUserProfile);

module.exports = router;
