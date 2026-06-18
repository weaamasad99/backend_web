const Paper = require('../models/Paper');
const User = require('../models/User');

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
    const { title, abstract, content, tags } = req.body;
    
    // Find the current user in MongoDB using Firebase uid
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      res.status(404);
      throw new Error('User not found in DB');
    }

    const paper = new Paper({
      title,
      abstract,
      content,
      tags,
      uploadedBy: user._id,
    });

    const createdPaper = await paper.save();
    res.status(201).json(createdPaper);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPapers,
  getPaperById,
  uploadPaper,
};
