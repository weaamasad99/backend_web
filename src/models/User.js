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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);
