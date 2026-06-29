const express = require('express');
const router = express.Router();
const { getMyProgress, getStudentProgress } = require('../controllers/progressController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/progress
router.get('/me', protect, getMyProgress);
router.get('/student/:id', protect, getStudentProgress);

module.exports = router;
