const { ssGet } = require('./semanticScholarClient');
const { fetchCitationCountCrossref } = require('./crossrefService');

/**
 * Fetch the citation count for a paper by its title.
 * Primary source: Semantic Scholar. Falls back to Crossref when Semantic
 * Scholar fails or rate-limits (429). Returns 0 if both fail, so upload never
 * breaks on an external lookup.
 * @param {string} title
 * @returns {Promise<number>}
 */
const fetchCitationCount = async (title) => {
  if (!title || !title.trim()) return 0;

  try {
    const data = await ssGet('/paper/search', {
      query: title,
      fields: 'title,citationCount',
      limit: 1,
    });
    const match = data?.data?.[0];
    if (typeof match?.citationCount === 'number') return match.citationCount;
  } catch (error) {
    console.error('Citation lookup (Semantic Scholar) failed:', error.response?.status || error.message);
  }

  // Fallback: Crossref (is-referenced-by-count).
  return fetchCitationCountCrossref(title);
};

module.exports = { fetchCitationCount };
