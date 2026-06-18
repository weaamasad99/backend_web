const express = require('express');
const router = express.Router();
const { getPapers, getPaperById, uploadPaper } = require('../controllers/paperController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/papers
router.route('/')
  .get(protect, getPapers)
  .post(protect, uploadPaper);

router.route('/:id')
  .get(protect, getPaperById);

module.exports = router;
