const Progress = require('../models/Progress');
const User = require('../models/User');
const { scoreToLevel } = require('../services/comprehensionService');
const { translateText } = require('../services/geminiService');

/**
 * Insert or update a student's progress for a paper. Reusable from the chat hook.
 * @returns {Promise<{score:number, understandingLevel:string}>}
 */
const upsertProgress = async (studentId, paperId, score, rationale) => {
  const understandingLevel = scoreToLevel(score);
  const updateData = { score, understandingLevel };
  if (rationale) {
    updateData.rationale = rationale;
  }
  await Progress.findOneAndUpdate(
    { student: studentId, paper: paperId },
    updateData,
    { upsert: true, setDefaultsOnInsert: true }
  );
  return { score, understandingLevel, rationale };
};

// @desc    Get the logged-in student's progress across all papers
// @route   GET /api/progress/me
// @access  Private
const getMyProgress = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }
    const items = await Progress.find({ student: user._id }).select('paper score understandingLevel rationale rationaleHe');
    res.json(items);
  } catch (error) {
    next(error);
  }
};

// @desc    Get a specific student's progress (lecturer only)
// @route   GET /api/progress/student/:id
// @access  Private (lecturer)
const getStudentProgress = async (req, res, next) => {
  try {
    const requester = await User.findOne({ firebaseUid: req.user.uid });
    if (!requester || requester.role !== 'lecturer') {
      res.status(401);
      throw new Error('Not authorized');
    }
    const items = await Progress.find({ student: req.params.id }).select('paper score understandingLevel rationale rationaleHe');
    res.json(items);
  } catch (error) {
    next(error);
  }
};

// @desc    Translate the rationale for a student's progress to Hebrew and cache it
// @route   POST /api/progress/rationale-translation
// @access  Private
const getRationaleTranslation = async (req, res, next) => {
  try {
    const { studentId, paperId } = req.body;
    if (!studentId || !paperId) {
      res.status(400);
      throw new Error('studentId and paperId are required');
    }

    const progress = await Progress.findOne({ student: studentId, paper: paperId });
    if (!progress) {
      res.status(404);
      throw new Error('Progress record not found');
    }

    if (progress.rationaleHe) {
      return res.json({ rationaleHe: progress.rationaleHe });
    }

    if (!progress.rationale) {
      return res.json({ rationaleHe: '' });
    }

    const translated = await translateText(progress.rationale, 'Hebrew');
    progress.rationaleHe = translated;
    await progress.save();

    res.json({ rationaleHe: translated });
  } catch (error) {
    next(error);
  }
};

module.exports = { upsertProgress, getMyProgress, getStudentProgress, getRationaleTranslation };
