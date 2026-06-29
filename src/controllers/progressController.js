const Progress = require('../models/Progress');
const User = require('../models/User');
const { scoreToLevel } = require('../services/comprehensionService');

/**
 * Insert or update a student's progress for a paper. Reusable from the chat hook.
 * @returns {Promise<{score:number, understandingLevel:string}>}
 */
const upsertProgress = async (studentId, paperId, score) => {
  const understandingLevel = scoreToLevel(score);
  await Progress.findOneAndUpdate(
    { student: studentId, paper: paperId },
    { score, understandingLevel },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { score, understandingLevel };
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
    const items = await Progress.find({ student: user._id }).select('paper score understandingLevel');
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
    const items = await Progress.find({ student: req.params.id }).select('paper score understandingLevel');
    res.json(items);
  } catch (error) {
    next(error);
  }
};

module.exports = { upsertProgress, getMyProgress, getStudentProgress };
