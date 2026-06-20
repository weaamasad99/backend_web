const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const { getPapers, getPaperById, uploadPaper, deletePaper, queryPaper } = require('../controllers/paperController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/papers
router.route('/')
  .get(protect, getPapers)
  .post(protect, upload.single('pdfFile'), uploadPaper);

router.route('/:id')
  .get(protect, getPaperById)
  .delete(protect, deletePaper);

router.route('/:id/query')
  .post(protect, queryPaper);

module.exports = router;


