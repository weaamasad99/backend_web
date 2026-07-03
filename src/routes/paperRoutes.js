const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const { getPapers, getPaperById, uploadPaper, deletePaper, queryPaper, getPaperSuggestions, getSuggestionsForPapers, ingestPaperById, getPaperTranslation } = require('../controllers/paperController');
const { analyzePapers } = require('../controllers/analysisController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/papers
router.route('/')
  .get(protect, getPapers)
  .post(protect, upload.single('pdfFile'), uploadPaper);

// Route: /api/papers/analysis  (declared before /:id so it is not shadowed)
router.post('/analysis', protect, analyzePapers);

// Suggestions for a chosen set of papers (declared before /:id).
router.post('/suggestions', protect, getSuggestionsForPapers);

router.route('/:id')
  .get(protect, getPaperById)
  .delete(protect, deletePaper);

router.route('/:id/query')
  .post(protect, queryPaper);

// Hebrew translation of the paper's readable text (cached in the Paper doc).
router.get('/:id/translation', protect, getPaperTranslation);

router.post('/:id/ingest', protect, ingestPaperById);

// Most popular related papers, derived from the paper's extracted keywords.
router.get('/:id/suggestions', protect, getPaperSuggestions);

module.exports = router;


