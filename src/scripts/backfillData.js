// One-off backfill for papers already in the DB. New uploads get both fields
// automatically (see paperController); this script fixes historical records:
//   - citations : real-world count via Semantic Scholar (by title)
//   - keywords  : 20 significant terms extracted from the stored PDF text (Gemini)
//
// Usage:
//   node src/scripts/backfillData.js          # only papers missing data
//   node src/scripts/backfillData.js --force   # re-fetch for every paper
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Paper = require('../models/Paper');
const { fetchCitationCount } = require('../services/citationService');
const { extractPaperMetadata } = require('../services/geminiService');

const force = process.argv.includes('--force');

// External services are rate-limited. Space requests out.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const needsCitations = (p) => force || !p.citations || p.citations <= 0;
const needsKeywords = (p) => force || !p.keywords || p.keywords.length === 0;

const run = async () => {
  await connectDB();

  const filter = force
    ? {}
    : {
        $or: [
          { citations: { $lte: 0 } },
          { citations: { $exists: false } },
          { keywords: { $size: 0 } },
          { keywords: { $exists: false } },
        ],
      };
  // `content` is needed for keyword extraction.
  const papers = await Paper.find(filter).select('_id title citations keywords content');

  console.log(`Found ${papers.length} paper(s) to backfill${force ? ' (force)' : ''}.`);

  let citationsUpdated = 0;
  let keywordsUpdated = 0;
  let skipped = 0;

  for (const paper of papers) {
    let touched = false;
    const label = paper.title?.slice(0, 50);

    // 1. Citations (Semantic Scholar, by title)
    if (needsCitations(paper)) {
      const count = await fetchCitationCount(paper.title);
      if (count > 0) {
        paper.citations = count;
        citationsUpdated += 1;
        touched = true;
        console.log(`  ✓ citations  "${label}" → ${count}`);
      }
      await sleep(1100); // Semantic Scholar rate limit (~1 req/sec)
    }

    // 2. Keywords (Gemini, from stored PDF text)
    if (needsKeywords(paper)) {
      if (paper.content && paper.content.trim()) {
        try {
          const meta = await extractPaperMetadata(paper.content);
          if (meta.keywords && meta.keywords.length > 0) {
            paper.keywords = meta.keywords;
            keywordsUpdated += 1;
            touched = true;
            console.log(`  ✓ keywords   "${label}" → ${meta.keywords.length} terms`);
          }
        } catch (err) {
          console.error(`  ! keyword extraction failed for "${label}": ${err.message}`);
        }
      } else {
        console.log(`  – keywords   "${label}" → no stored content, skipped`);
      }
      await sleep(1100); // Gemini free-tier rate limit
    }

    if (touched) {
      await paper.save();
    } else {
      skipped += 1;
    }
  }

  console.log(`\nDone. Citations updated: ${citationsUpdated}, keywords updated: ${keywordsUpdated}, unchanged: ${skipped}.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (error) => {
  console.error('Backfill failed:', error.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
