const mongoose = require('mongoose');

const progressSchema = mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    paper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paper',
      required: true,
    },
    score: {
      type: Number,
      default: 0,
    },
    understandingLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'excellent'],
      default: 'low',
    },
    lecturerFeedback: {
      type: String,
    },
    // One-sentence AI justification of the comprehension score, shown to the
    // lecturer via the "Why this score?" button.
    rationale: {
      type: String,
      default: '',
    },
    // Cached Hebrew translation of `rationale`, produced lazily when a lecturer
    // views the explanation while the UI is in Hebrew.
    rationaleHe: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// A student has one progress record per paper
progressSchema.index({ student: 1, paper: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);
