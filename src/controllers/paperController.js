const Paper = require('../models/Paper');
const User = require('../models/User');
const { generateSocraticResponse, extractPaperMetadata } = require('../services/geminiService');
const { uploadPDFToCloudinary } = require('../services/cloudinaryService');
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

    let title, abstract, content, fileUrl, authors, year, methodology, keyFindings, topics;

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

      // 2. Upload the file buffer to Cloudinary
      try {
        const cloudinaryResult = await uploadPDFToCloudinary(pdfBuffer, originalName);
        fileUrl = cloudinaryResult.secure_url;
      } catch (err) {
        console.error('Failed to upload PDF to Cloudinary:', err.message);
        fileUrl = '#';
      }

      // 3. Query Gemini for structured metadata
      try {
        const metadata = await extractPaperMetadata(content);
        title = metadata.title || originalName.replace('.pdf', '');
        abstract = metadata.abstract || `Uploaded PDF document: ${originalName}`;
        authors = metadata.authors && metadata.authors.length > 0 ? metadata.authors : ['Uploaded User'];
        year = metadata.year || new Date().getFullYear();
        methodology = metadata.methodology || 'Extracted methodology';
        keyFindings = metadata.keyFindings && metadata.keyFindings.length > 0 ? metadata.keyFindings : ['Text parsed successfully'];
        topics = metadata.topics && metadata.topics.length > 0 ? metadata.topics : ['Uploaded'];
      } catch (err) {
        console.error('Failed to extract metadata with Gemini:', err.message);
        title = originalName.replace('.pdf', '');
        abstract = `Uploaded PDF document: ${originalName}`;
        authors = ['Uploaded User'];
        year = new Date().getFullYear();
        methodology = 'Unknown';
        keyFindings = ['Document uploaded successfully'];
        topics = ['Uploaded'];
      }
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
      uploadedBy: user._id,
    });

    const createdPaper = await paper.save();
    res.status(201).json(createdPaper);
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
      paper.content,
      studentMessage,
      []
    );

    res.json({ answer: botResponseText });
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
};


