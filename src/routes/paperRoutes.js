const express = require('express');
const router = express.Router();
const { getPapers, getPaperById, uploadPaper, deletePaper } = require('../controllers/paperController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/papers
router.route('/')
  .get(protect, getPapers)
  .post(protect, uploadPaper);

router.route('/:id')
  .get(protect, getPaperById)
  .delete(protect, deletePaper);

module.exports = router;

