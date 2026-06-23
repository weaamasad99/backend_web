const axios = require('axios');

// Shared Semantic Scholar client. Centralizes:
//  - optional API key (SEMANTIC_SCHOLAR_API_KEY) for much higher rate limits
//  - retry with exponential backoff on 429 (rate limit) and 5xx
//  - a polite User-Agent (recommended by the API)
//
// Without an API key the public pool is small and shared across all anonymous
// callers, so 429s are common under load. Set SEMANTIC_SCHOLAR_API_KEY to avoid
// them: https://www.semanticscholar.org/product/api#api-key

const BASE = 'https://api.semanticscholar.org/graph/v1';
const API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a Semantic Scholar Graph API path with retry/backoff.
 * @param {string} path   e.g. '/paper/search'
 * @param {object} params query params
 * @param {number} retries number of retries on 429/5xx (default 3)
 * @returns {Promise<object>} response.data
 * @throws on non-retryable errors or after exhausting retries
 */
const ssGet = async (path, params, retries = 3) => {
  const headers = { 'User-Agent': 'ResearchAI/1.0 (academic project)' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await axios.get(`${BASE}${path}`, { params, headers, timeout: 12000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      if (retryable && attempt < retries) {
        // 429 may include Retry-After (seconds); otherwise exponential backoff.
        const retryAfter = parseInt(err.response?.headers?.['retry-after'], 10);
        const waitMs = retryAfter ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 8000);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
};

module.exports = { ssGet, hasApiKey: () => !!API_KEY };
