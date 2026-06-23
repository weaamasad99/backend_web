const axios = require('axios');

// Crossref API — free, no key, generous limits. Used as a fallback when
// Semantic Scholar rate-limits us (429). "Citations" here = is-referenced-by-count.
// A mailto in the User-Agent puts us in Crossref's faster "polite" pool.
const BASE = 'https://api.crossref.org/works';
const UA = `ResearchAI/1.0 (mailto:${process.env.CONTACT_EMAIL || 'shgonen08@gmail.com'})`;

const authorsOf = (item) =>
  (item.author || [])
    .map((a) => [a.given, a.family].filter(Boolean).join(' '))
    .filter(Boolean);

const yearOf = (item) => item.issued?.['date-parts']?.[0]?.[0] || null;

/**
 * Citation count for a paper by title (first match), via Crossref.
 * @returns {Promise<number>} 0 on any failure.
 */
const fetchCitationCountCrossref = async (title) => {
  if (!title || !title.trim()) return 0;
  try {
    const res = await axios.get(BASE, {
      params: { query: title, rows: 1, select: 'title,is-referenced-by-count' },
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });
    const item = res.data?.message?.items?.[0];
    return item?.['is-referenced-by-count'] || 0;
  } catch (error) {
    console.error('Crossref citation lookup failed:', error.response?.status || error.message);
    return 0;
  }
};

/**
 * Most-cited papers related to keywords, via Crossref. Normalized to the same
 * shape as the Semantic Scholar suggestions.
 * @returns {Promise<Array>} empty on failure.
 */
const fetchPopularPapersCrossref = async (keywords = [], limit = 8) => {
  const terms = (keywords || []).filter((k) => k && k.trim());
  if (terms.length === 0) return [];
  const query = terms.slice(0, 10).join(' ');

  try {
    const res = await axios.get(BASE, {
      params: {
        query,
        rows: Math.min(Math.max(limit * 3, limit), 100),
        select: 'title,author,is-referenced-by-count,DOI,issued,abstract',
      },
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });

    return (res.data?.message?.items || [])
      .filter((i) => i.title?.[0])
      .sort((a, b) => (b['is-referenced-by-count'] || 0) - (a['is-referenced-by-count'] || 0))
      .slice(0, limit)
      .map((i) => ({
        externalId: i.DOI || i.title[0],
        title: i.title[0],
        abstract: (i.abstract || '').replace(/<[^>]+>/g, '').trim(), // strip JATS tags
        authors: authorsOf(i),
        year: yearOf(i),
        citations: i['is-referenced-by-count'] || 0,
        url: i.DOI ? `https://doi.org/${i.DOI}` : '#',
      }));
  } catch (error) {
    console.error('Crossref suggestion lookup failed:', error.response?.status || error.message);
    return [];
  }
};

module.exports = { fetchCitationCountCrossref, fetchPopularPapersCrossref };
