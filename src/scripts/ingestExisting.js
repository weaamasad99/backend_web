require('dotenv').config();
const connectDB = require('../config/db');
const Paper = require('../models/Paper');
const PaperChunk = require('../models/PaperChunk');
const { ingestPaper } = require('../services/ragService');

(async () => {
  try {
    await connectDB();
    const papers = await Paper.find().select('_id content uploadedBy title');
    let done = 0;
    for (const p of papers) {
      const existing = await PaperChunk.countDocuments({ paper: p._id });
      if (existing > 0) {
        console.log(`skip "${p.title}" (already has ${existing} chunks)`);
        continue;
      }
      try {
        const count = await ingestPaper(p._id, p.content, p.uploadedBy);
        console.log(`ingested "${p.title}": ${count} chunks`);
        done++;
      } catch (err) {
        console.error(`failed "${p.title}": ${err.message}`);
      }
    }
    console.log(`Backfill complete. Ingested ${done} papers.`);
    process.exit(0);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
})();
