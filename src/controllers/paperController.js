const Paper = require('../models/Paper');
const User = require('../models/User');
const { generateSocraticResponse, extractPaperMetadata, translateToHebrew } = require('../services/geminiService');
const { uploadPDFToCloudinary } = require('../services/cloudinaryService');
const { ingestPaper } = require('../services/ragService');
const { fetchCitationCount } = require('../services/citationService');
const { fetchPopularPapersByKeywords } = require('../services/suggestionService');
const { PDFParse } = require('pdf-parse');

// @desc    Get all papers
// @route   GET /api/papers
// @access  Private
const getPapers = async (req, res, next) => {
  try {
    const papers = await Paper.find({}).select('-content'); // Exclude full content for listing
    res.json(papers);
  } catch (error) {
    next(error);
  }
};

// @desc    Get paper by ID
// @route   GET /api/papers/:id
// @access  Private
const getPaperById = async (req, res, next) => {
  try {
    const paper = await Paper.findById(req.params.id);
    if (paper) {
      res.json(paper);
    } else {
      res.status(404);
      throw new Error('Paper not found');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Upload a new paper
// @route   POST /api/papers
// @access  Private (Lecturer only in a real app)
const uploadPaper = async (req, res, next) => {
  try {
    // Find the current user in MongoDB using Firebase uid
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      res.status(404);
      throw new Error('User not found in DB');
    }

    let title, abstract, content, fileUrl, authors, year, methodology, keyFindings, topics, citations, keywords;

    // Check if a file is uploaded
    if (req.file) {
      const pdfBuffer = req.file.buffer;
      const originalName = req.file.originalname;

      console.log(`Processing file upload: ${originalName}`);

      // 1. Extract text from PDF buffer using pdf-parse
      try {
        const parser = new PDFParse({ data: pdfBuffer });
        const parsedPdf = await parser.getText();
        content = parsedPdf.text || '';
      } catch (err) {
        console.error('Failed to parse PDF buffer:', err.message);
        content = `Extracted from ${originalName} but text extraction failed.`;
      }

      // 2 + 3. Upload to Cloudinary and extract metadata concurrently — they're
      // independent and both slow, so awaiting them in parallel halves the wait.
      const [cloudinaryResult, metadata] = await Promise.all([
        uploadPDFToCloudinary(pdfBuffer, originalName).catch((err) => {
          console.error('Failed to upload PDF to Cloudinary:', err.message);
          return null;
        }),
        extractPaperMetadata(content).catch((err) => {
          console.error('Failed to extract metadata with Gemini:', err.message);
          return null;
        }),
      ]);

      fileUrl = cloudinaryResult?.secure_url || '#';

      const m = metadata || {};
      title = m.title || originalName.replace('.pdf', '');
      abstract = m.abstract || `Uploaded PDF document: ${originalName}`;
      authors = m.authors && m.authors.length > 0 ? m.authors : ['Uploaded User'];
      year = m.year || new Date().getFullYear();
      methodology = m.methodology || 'Unknown';
      keyFindings = m.keyFindings && m.keyFindings.length > 0 ? m.keyFindings : ['Document uploaded successfully'];
      topics = m.topics && m.topics.length > 0 ? m.topics : ['Uploaded'];
      keywords = m.keywords && m.keywords.length > 0 ? m.keywords : topics;

      // Citation lookup hits an external scholarly API — deferred to after the
      // response (updated in the background) so it never blocks the upload.
      citations = 0;
    } else {
      // Fallback to body properties (backward compatibility)
      const { tags } = req.body;
      title = req.body.title;
      abstract = req.body.abstract;
      content = req.body.content;
      authors = req.body.authors || ['Uploaded'];
      year = req.body.year || new Date().getFullYear();
      methodology = req.body.methodology || 'Unknown';
      keyFindings = req.body.keyFindings || [];
      topics = req.body.topics || tags || [];
      fileUrl = req.body.fileUrl || '#';
      citations = req.body.citations || 0;
      keywords = req.body.keywords || [];
    }

    const paper = new Paper({
      title,
      abstract,
      content,
      fileUrl,
      tags: topics || [],
      authors: authors || ['Uploaded'],
      year: year || new Date().getFullYear(),
      methodology: methodology || 'Unknown',
      keyFindings: keyFindings || [],
      topics: topics || [],
      keywords: keywords || [],
      citations: citations || 0,
      uploadedBy: user._id,
    });

    const createdPaper = await paper.save();

    // Respond immediately so the upload feels fast. The heavy work below runs
    // in the background and must never touch the (already sent) response.
    res.status(201).json(createdPaper);

    // Background 1: RAG ingestion (chunk embeddings). Failure must not fail the
    // upload — chat falls back to truncated content until chunks are ready.
    if (content) {
      ingestPaper(createdPaper._id, content, user._id)
        .then((count) => console.log(`Ingested ${count} chunks for paper ${createdPaper._id}`))
        .catch((ingestErr) => console.error('RAG ingestion failed (paper still saved):', ingestErr.message));
    }

    // Background 2: real-world citation count — patch the doc once it arrives.
    if (req.file && title) {
      fetchCitationCount(title)
        .then((count) => (count ? Paper.updateOne({ _id: createdPaper._id }, { citations: count }) : null))
        .catch((citeErr) => console.error('Citation lookup failed:', citeErr.message));
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a paper
// @route   DELETE /api/papers/:id
// @access  Private
const deletePaper = async (req, res, next) => {
  try {
    const paper = await Paper.findById(req.params.id);
    if (paper) {
      await Paper.findByIdAndDelete(req.params.id);
      res.json({ message: 'Paper deleted successfully' });
    } else {
      res.status(404);
      throw new Error('Paper not found');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Query a paper using Socratic bot
// @route   POST /api/papers/:id/query
// @access  Private
const queryPaper = async (req, res, next) => {
  try {
    const { question, guide } = req.body;
    const paperId = req.params.id;

    const paper = await Paper.findById(paperId);
    if (!paper) {
      res.status(404);
      throw new Error('Paper not found');
    }

    let studentMessage = question;
    if (guide && guide.trim()) {
      studentMessage = `Student Question: ${question}\nGuidance Context/Focus: ${guide}`;
    }

    // Call Socratic Gemini response generator
    const botResponseText = await generateSocraticResponse(
      paper._id,
      paper.content,
      studentMessage,
      [],
      paper.keywords || []
    );

    res.json({ answer: botResponseText });
  } catch (error) {
    next(error);
  }
};

// @desc    Get the most popular related papers for a paper, based on the
//          keywords extracted from its PDF and stored in the DB.
// @route   GET /api/papers/:id/suggestions
// @access  Private
const SUGGESTIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const getPaperSuggestions = async (req, res, next) => {
  try {
    const paper = await Paper.findById(req.params.id)
      .select('keywords topics title suggestions suggestionsUpdatedAt');
    if (!paper) {
      res.status(404);
      throw new Error('Paper not found');
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);

    // Serve from the DB cache when it's still fresh — avoids re-hitting the
    // external APIs on every view. `?refresh=1` forces a re-fetch.
    const fresh =
      paper.suggestionsUpdatedAt &&
      Date.now() - new Date(paper.suggestionsUpdatedAt).getTime() < SUGGESTIONS_TTL_MS;
    if (fresh && Array.isArray(paper.suggestions) && paper.suggestions.length > 0 && req.query.refresh !== '1') {
      return res.json(paper.suggestions.slice(0, limit));
    }

    // Prefer the 20 extracted keywords; fall back to topics, then the title.
    const seed =
      (paper.keywords && paper.keywords.length > 0 && paper.keywords) ||
      (paper.topics && paper.topics.length > 0 && paper.topics) ||
      [paper.title];

    const suggestions = await fetchPopularPapersByKeywords(seed, Math.max(limit, 8));

    // Persist for next time (only when we actually got results).
    if (suggestions.length > 0) {
      paper.suggestions = suggestions;
      paper.suggestionsUpdatedAt = new Date();
      await paper.save();
    }

    res.json(suggestions.slice(0, limit));
  } catch (error) {
    next(error);
  }
};

// @desc    Suggestions for a user-chosen set of papers. Merges the keywords of
//          all selected papers and returns the most popular related papers.
// @route   POST /api/papers/suggestions   body: { paperIds: string[], limit? }
// @access  Private
const getSuggestionsForPapers = async (req, res, next) => {
  try {
    const { paperIds, limit = 8 } = req.body;
    if (!Array.isArray(paperIds) || paperIds.length === 0) {
      res.status(400);
      throw new Error('paperIds (non-empty array) is required');
    }

    const papers = await Paper.find({ _id: { $in: paperIds } }).select('keywords topics title');
    if (papers.length === 0) {
      res.status(404);
      throw new Error('No papers found for the provided ids');
    }

    // Merge the selected papers' keywords (dedup), falling back to topics/title.
    const seedSet = new Set();
    papers.forEach((p) => {
      const terms =
        (p.keywords && p.keywords.length > 0 && p.keywords) ||
        (p.topics && p.topics.length > 0 && p.topics) ||
        [p.title];
      terms.forEach((t) => t && seedSet.add(t));
    });

    const lim = Math.min(parseInt(limit, 10) || 8, 20);
    const suggestions = await fetchPopularPapersByKeywords([...seedSet], Math.max(lim, 8));
    res.json(suggestions.slice(0, lim));
  } catch (error) {
    next(error);
  }
};

// @desc    Re-index a paper into the RAG store (manual backfill/refresh)
// @route   POST /api/papers/:id/ingest
// @access  Private
const ingestPaperById = async (req, res, next) => {
  try {
    const paper = await Paper.findById(req.params.id);
    if (!paper) {
      res.status(404);
      throw new Error('Paper not found');
    }
    const count = await ingestPaper(paper._id, paper.content, paper.uploadedBy);
    res.json({ paperId: paper._id, chunks: count });
  } catch (error) {
    next(error);
  }
};

// @desc    Get (and cache) a Hebrew translation of a paper's readable text
// @route   GET /api/papers/:id/translation?lang=he
// @access  Private
const getPaperTranslation = async (req, res, next) => {
  try {
    const lang = req.query.lang || 'he';
    if (lang !== 'he') {
      return res.status(400).json({ message: 'Only Hebrew (he) translation is supported.' });
    }

    const paper = await Paper.findById(req.params.id);
    if (!paper) {
      return res.status(404).json({ message: 'Paper not found' });
    }

    // Cache hit — return the stored translation, no Gemini call.
    if (paper.translations && paper.translations.he) {
      return res.json(paper.translations.he);
    }

    const translated = await translateToHebrew({
      title: paper.title,
      abstract: paper.abstract,
      methodology: paper.methodology,
      keyFindings: paper.keyFindings,
    });

    const stored = { ...translated, translatedAt: new Date() };
    paper.translations = { ...(paper.translations || {}), he: stored };
    paper.markModified('translations'); // Object type — tell Mongoose it changed.
    await paper.save();

    res.json(stored);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPapers,
  getPaperById,
  uploadPaper,
  deletePaper,
  queryPaper,
  getPaperSuggestions,
  getSuggestionsForPapers,
  ingestPaperById,
  getPaperTranslation,
};


