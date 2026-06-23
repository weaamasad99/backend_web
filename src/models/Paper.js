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
    authors: {
      type: [String],
      default: ['Unknown Author'],
    },
    year: {
      type: Number,
      default: () => new Date().getFullYear(),
    },
    citations: {
      type: Number,
      default: 0,
    },
    methodology: {
      type: String,
      default: 'Unknown',
    },
    keyFindings: {
      type: [String],
      default: [],
    },
    topics: {
      type: [String],
      default: [],
    },
    // 20 significant keywords extracted from the PDF. Used to (a) find the most
    // popular related papers and (b) seed the Research Chat / analyser context.
    keywords: {
      type: [String],
      default: [],
    },
    tags: [String],
    // Cached "most popular related papers" so we don't re-hit external APIs on
    // every view. Refreshed when older than the TTL (see getPaperSuggestions).
    suggestions: {
      type: Array,
      default: [],
    },
    suggestionsUpdatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'papers',
  }
);

module.exports = mongoose.model('Paper', paperSchema, 'papers');


