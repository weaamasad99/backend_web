const mongoose = require('mongoose');

const paperSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    abstract: {
      type: String,
    },
    content: {
      type: String, // The extracted text or PDF content of the paper
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true, // Typically the lecturer
    },
    fileUrl: {
      type: String, // URL if stored in cloud storage (e.g. Firebase storage)
    },
    tags: [String],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Paper', paperSchema);
