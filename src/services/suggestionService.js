const { ssGet } = require('./semanticScholarClient');
const { fetchPopularPapersCrossref } = require('./crossrefService');

// In-memory cache: identical keyword queries reuse the last result instead of
// re-hitting the API (which causes 429s under repeated Library mounts).
const cache = new Map(); // query -> { at, data }
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Find the most popular (most-cited) papers related to a set of keywords.
 * Results are sorted by real-world citation count, descending.
 *
 * @param {string[]} keywords  Significant terms extracted from the paper
 * @param {number} limit       How many suggestions to return (default 8)
 * @returns {Promise<Array>}   Normalized suggestion objects (empty on failure)
 */
const fetchPopularPapersByKeywords = async (keywords = [], limit = 8) => {
  const terms = (keywords || []).filter((k) => k && k.trim());
  if (terms.length === 0) return [];

  // Use the most informative keywords as the relevance query.
  const query = terms.slice(0, 10).join(' ');

  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data.slice(0, limit);
  }

  // Primary: Semantic Scholar.
  try {
    const data = await ssGet('/paper/search', {
      query,
      limit: Math.min(Math.max(limit * 3, limit), 100),
      fields: 'title,abstract,authors,year,citationCount,externalIds,url',
    });

    const result = (data?.data || [])
      .filter((p) => p && p.title)
      .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
      .map((p) => ({
        externalId: p.paperId || p.externalIds?.DOI || p.title,
        title: p.title,
        abstract: p.abstract || '',
        authors: (p.authors || []).map((a) => a.name).filter(Boolean),
        year: p.year || null,
        citations: p.citationCount || 0,
        url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : '#'),
      }));

    if (result.length > 0) {
      cache.set(query, { at: Date.now(), data: result });
      return result.slice(0, limit);
    }
  } catch (error) {
    console.error('Suggestion lookup (Semantic Scholar) failed:', error.response?.status || error.message);
    if (cached) return cached.data.slice(0, limit); // stale-but-useful on 429
  }

  // Fallback: Crossref (works without an API key when Semantic Scholar blocks us).
  const crossref = await fetchPopularPapersCrossref(terms, limit);
  if (crossref.length > 0) cache.set(query, { at: Date.now(), data: crossref });
  return crossref;
};

module.exports = { fetchPopularPapersByKeywords };
