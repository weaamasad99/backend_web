const express = require('express');
const router = express.Router();
const { getMyProgress, getStudentProgress, getRationaleTranslation } = require('../controllers/progressController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/progress
router.get('/me', protect, getMyProgress);
router.get('/student/:id', protect, getStudentProgress);
router.post('/rationale-translation', protect, getRationaleTranslation);

module.exports = router;
