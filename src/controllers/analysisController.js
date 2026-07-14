const Paper = require('../models/Paper');
const User = require('../models/User');
const { comparePapers: geminiComparePapers } = require('../services/geminiService');

// Criteria used when none of the student's approved supervisors defined any.
const DEFAULT_CRITERIA = ['Methodology', 'Examined parameters'];
const DIFFICULTY_CRITERION = 'Difficulty level';

// Bucket a methodology string into one of four coarse categories.
const classifyMethodology = (methodology = '') => {
  const m = methodology.toLowerCase();
  if (m.includes('survey') || m.includes('literature')) return 'Literature Review';
  if (m.includes('experimental') || m.includes('analysis')) return 'Experimental';
  if (m.includes('quantitative')) return 'Quantitative';
  return 'Qualitative';
};

// Compute the full lecturer-facing analysis from a set of papers.
const computeAnalysis = (papers, depth) => {
  const totalArticles = papers.length;
  const totalCitations = papers.reduce((sum, p) => sum + (p.citations || 0), 0);
  const avgCitations = totalArticles ? Math.round(totalCitations / totalArticles) : 0;

  // Year distribution
  const yearCounts = papers.reduce((acc, p) => {
    const y = p.year || new Date().getFullYear();
    acc[y] = (acc[y] || 0) + 1;
    return acc;
  }, {});
  const yearData = Object.entries(yearCounts)
    .map(([year, count]) => ({ year: parseInt(year, 10), count }))
    .sort((a, b) => a.year - b.year);

  // Topic frequency (top 6)
  const topicCounts = papers.reduce((acc, p) => {
    (p.topics || []).forEach((t) => {
      acc[t] = (acc[t] || 0) + 1;
    });
    return acc;
  }, {});
  const topicData = Object.entries(topicCounts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const uniqueTopics = Object.keys(topicCounts).length;

  // Methodology breakdown
  const methodCounts = papers.reduce((acc, p) => {
    const method = classifyMethodology(p.methodology);
    acc[method] = (acc[method] || 0) + 1;
    return acc;
  }, {});
  const methodData = Object.entries(methodCounts).map(([name, value]) => ({ name, value }));

  // Citation distribution per paper (most-cited first)
  const citationData = papers
    .map((p, idx) => ({
      name: `Paper ${idx + 1}`,
      citations: p.citations || 0,
      title: (p.title || '').substring(0, 30) + '...',
    }))
    .sort((a, b) => b.citations - a.citations);

  // Quality radar (0-100 heuristics)
  const maxYear = totalArticles ? Math.max(...papers.map((p) => p.year || 0)) : 0;
  const maxCitations = totalArticles ? Math.max(...papers.map((p) => p.citations || 0)) : 0;
  const qualityMetrics = [
    { metric: 'Avg Impact', score: Math.min(100, avgCitations / 5) },
    { metric: 'Recency', score: Math.min(100, ((maxYear - 2020) / 6) * 100) },
    { metric: 'Coverage', score: Math.min(100, (uniqueTopics / 10) * 100) },
    { metric: 'Depth', score: depth === 'Deep' ? 95 : depth === 'Regular' ? 75 : 50 },
    { metric: 'Consistency', score: 70 + Math.random() * 25 },
  ];

  // Human-readable insights
  const insights = [
    {
      title: 'Publication Trend',
      description: `${Math.round(((yearData[yearData.length - 1]?.count || 0) / (yearData[0]?.count || 1)) * 100)}% increase in publications over the analyzed period, indicating growing research interest.`,
    },
    {
      title: 'Dominant Topics',
      description: `"${topicData[0]?.topic || 'N/A'}" appears most frequently (${topicData[0]?.count || 0}× across papers), suggesting it's a central theme in your corpus.`,
    },
    {
      title: 'Methodology Balance',
      description: `${methodData.length} distinct research methodologies identified. ${methodData[0]?.name || 'N/A'} approach is most common (${totalArticles ? Math.round(((methodData[0]?.value || 0) / totalArticles) * 100) : 0}%).`,
    },
    {
      title: 'Citation Impact',
      description: `Average ${avgCitations} citations per paper. Top paper has ${maxCitations} citations, ${avgCitations ? Math.round((maxCitations / avgCitations - 1) * 100) : 0}% above average.`,
    },
  ];

  return {
    stats: { totalArticles, avgCitations, totalCitations, uniqueTopics },
    citationData,
    qualityMetrics,
    yearData,
    methodData,
    topicData,
    insights,
  };
};

// @desc    Analyze a set of papers. Role-aware: lecturers get the full
//          computed dashboard payload, students get a lightweight receipt only.
// @route   POST /api/papers/analysis
// @access  Private
const analyzePapers = async (req, res, next) => {
  try {
    const { paperIds, depth = 'Regular' } = req.body;

    if (!Array.isArray(paperIds) || paperIds.length === 0) {
      res.status(400);
      throw new Error('paperIds (non-empty array) is required');
    }

    // Determine the caller's role from MongoDB (token only carries uid/email).
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      res.status(404);
      throw new Error('User not found in DB');
    }

    const papers = await Paper.find({ _id: { $in: paperIds } }).select('-content');
    if (papers.length === 0) {
      res.status(404);
      throw new Error('No papers found for the provided ids');
    }

    const id = `an-${paperIds.join('-').slice(0, 24)}`;
    const createdAt = new Date().toISOString();

    // Students never receive chart data — only a confirmation receipt.
    if (user.role !== 'lecturer') {
      return res.json({
        id,
        role: 'student',
        status: 'ready',
        createdAt,
        depth,
      });
    }

    // Lecturers get the full server-computed analysis.
    const analysis = computeAnalysis(papers, depth);
    res.json({
      id,
      role: 'lecturer',
      status: 'ready',
      createdAt,
      depth,
      ...analysis,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    AI comparison of papers by criteria (difficulty always included;
//          supervisors' criteria when defined, defaults otherwise)
// @route   POST /api/papers/compare
// @access  Private
const comparePapersByCriteria = async (req, res, next) => {
  try {
    const { paperIds, language = 'en' } = req.body;

    if (!Array.isArray(paperIds) || paperIds.length < 2) {
      res.status(400);
      throw new Error('paperIds (array with at least 2 ids) is required');
    }

    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      res.status(404);
      throw new Error('User not found in DB');
    }

    // Union of criteria from the student's APPROVED supervisors. A lecturer
    // comparing papers uses their own criteria.
    let lecturerCriteria = [];
    if (user.role === 'lecturer') {
      lecturerCriteria = user.comparisonCriteria || [];
    } else {
      const approvedIds = (user.supervisors || [])
        .filter((s) => s.status === 'approved')
        .map((s) => s.lecturer);
      if (approvedIds.length > 0) {
        const lecturers = await User.find({ _id: { $in: approvedIds } }).select('comparisonCriteria');
        const seen = new Set();
        lecturers.forEach((l) =>
          (l.comparisonCriteria || []).forEach((c) => {
            const key = c.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              lecturerCriteria.push(c);
            }
          })
        );
      }
    }

    const criteria = [
      DIFFICULTY_CRITERION,
      ...(lecturerCriteria.length > 0 ? lecturerCriteria : DEFAULT_CRITERIA),
    ].filter((c, i, arr) => arr.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);

    const papers = await Paper.find({ _id: { $in: paperIds } })
      .select('title abstract methodology keywords');
    if (papers.length < 2) {
      res.status(404);
      throw new Error('At least 2 of the requested papers must exist');
    }

    const result = await geminiComparePapers(papers, criteria, language);

    res.json({
      criteria,
      criteriaSource: lecturerCriteria.length > 0 ? 'supervisor' : 'default',
      papers: result.papers,
      difficultySummary: result.difficultySummary,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { analyzePapers, comparePapersByCriteria };
