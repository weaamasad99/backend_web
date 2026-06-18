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
  },
  {
    timestamps: true,
  }
);

// A student has one progress record per paper
progressSchema.index({ student: 1, paper: 1 }, { unique: true });

module.exports = mongoose.model('Progress', progressSchema);
