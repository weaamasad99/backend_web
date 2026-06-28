const mongoose = require('mongoose');

const paperChunkSchema = mongoose.Schema(
  {
    paper: { type: mongoose.Schema.Types.ObjectId, ref: 'Paper', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    chunkIndex: { type: Number, required: true },
    chunkText: { type: String, required: true },
    embedding: { type: [Number], required: true }, // 768 dims (text-embedding-004)
  },
  { timestamps: true }
);

paperChunkSchema.index({ paper: 1, chunkIndex: 1 });

module.exports = mongoose.model('PaperChunk', paperChunkSchema, 'paper_chunks');
