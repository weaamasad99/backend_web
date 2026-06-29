// Pure helpers for comprehension scoring. No external deps so it is trivially testable.

/**
 * Map a 0-100 comprehension score to the Progress.understandingLevel enum.
 * Out-of-range scores are clamped.
 * @param {number} score
 * @returns {'low'|'medium'|'high'|'excellent'}
 */
function scoreToLevel(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s < 40) return 'low';
  if (s < 65) return 'medium';
  if (s < 85) return 'high';
  return 'excellent';
}

module.exports = { scoreToLevel };
