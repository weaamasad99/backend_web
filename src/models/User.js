const mongoose = require('mongoose');

const userSchema = mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: String,
      enum: ['student', 'lecturer'],
      default: 'student',
    },
    profilePicture: {
      type: String,
      default: '',
    },
    institution: {
      type: String,
      default: '',
    },
    // User preferences (persisted so they survive across devices/logins).
    researchField: {
      type: String,
      default: '',
    },
    citationFormat: {
      type: String,
      enum: ['APA', 'MLA', 'Chicago'],
      default: 'APA',
    },
    defaultDepth: {
      type: Number,
      enum: [1, 2, 3],
      default: 2,
    },
    // Paper-comparison criteria defined by a lecturer. Applied to every
    // student this lecturer supervises; empty = students fall back to the
    // default criteria (methodology + examined parameters).
    comparisonCriteria: {
      type: [String],
      default: [],
    },
    // Supervisor Relationships (For Students) — a student may have several
    // supervisors. Rejection/cancellation removes the entry from the array.
    supervisors: [
      {
        lecturer: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        status: {
          type: String,
          enum: ['pending', 'approved'],
          default: 'pending',
        },
      },
    ],
    // Legacy single-supervisor fields — kept so existing documents load; folded
    // into `supervisors` on profile read and then cleared.
    supervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    supervisorStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);
