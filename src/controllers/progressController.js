const Progress = require('../models/Progress');
const User = require('../models/User');
const { scoreToLevel } = require('../services/comprehensionService');
const { translateStringToHebrew } = require('../services/geminiService');

/**
 * Insert or update a student's progress for a paper. Reusable from the chat hook.
 * @returns {Promise<{score:number, understandingLevel:string}>}
 */
const upsertProgress = async (studentId, paperId, score, rationale = '') => {
  const understandingLevel = scoreToLevel(score);
  await Progress.findOneAndUpdate(
    { student: studentId, paper: paperId },
    // Clear the cached Hebrew translation whenever the rationale changes.
    { score, understandingLevel, rationale, rationaleHe: '' },
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
    const items = await Progress.find({ student: user._id }).select('paper score understandingLevel rationale');
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
    const items = await Progress.find({ student: req.params.id }).select('paper score understandingLevel rationale');
    res.json(items);
  } catch (error) {
    next(error);
  }
};

// @desc    Hebrew translation of a comprehension-score rationale (cached)
// @route   POST /api/progress/rationale-translation
// @access  Private (lecturer, or the student themselves)
const getRationaleTranslation = async (req, res, next) => {
  try {
    const requester = await User.findOne({ firebaseUid: req.user.uid });
    if (!requester) {
      res.status(404);
      throw new Error('User not found');
    }

    const { studentId, paperId } = req.body;
    if (!studentId || !paperId) {
      res.status(400);
      throw new Error('studentId and paperId are required');
    }

    // Only a lecturer or the student themselves may read the rationale.
    if (requester.role !== 'lecturer' && requester._id.toString() !== studentId) {
      res.status(401);
      throw new Error('Not authorized');
    }

    const progress = await Progress.findOne({ student: studentId, paper: paperId });
    if (!progress || !progress.rationale) {
      return res.json({ rationaleHe: '' });
    }

    if (!progress.rationaleHe) {
      progress.rationaleHe = await translateStringToHebrew(progress.rationale);
      await progress.save();
    }

    res.json({ rationaleHe: progress.rationaleHe });
  } catch (error) {
    next(error);
  }
};

module.exports = { upsertProgress, getMyProgress, getStudentProgress, getRationaleTranslation };
