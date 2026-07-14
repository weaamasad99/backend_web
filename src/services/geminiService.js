const { GoogleGenAI } = require('@google/genai');
const { embedTexts, retrieveChunks, TOP_K, withGeminiRetry } = require('./ragService');
const { scoreToLevel } = require('./comprehensionService');

// Separate keys isolate bursty ingestion from interactive chat quota so heavy
// uploads don't throttle (429-retry) interactive chat and slow its responses.
// Chat stays on the primary key; ingestion prefers the ADDITIONAL_API_KEY.
// Both fall back to the legacy GEMINI_API_KEY for backward compatibility.
const CHAT_KEY = process.env.GEMINI_CHAT_KEY || process.env.GEMINI_API_KEY;
const INGEST_KEY =
  process.env.GEMINI_INGEST_KEY || process.env.ADDITIONAL_API_KEY || process.env.GEMINI_API_KEY;

const chatAI = new GoogleGenAI({ apiKey: CHAT_KEY });
const ingestAI = new GoogleGenAI({ apiKey: INGEST_KEY });

// Free-tier flash model; override with GEMINI_MODEL in .env if needed.
// `gemini-flash-latest` is an always-available alias that avoids the periodic
// 503 "high demand" spikes seen on pinned versions like gemini-2.5-flash.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Retry transient errors (503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED) so a brief
// model overload doesn't silently degrade extraction to fallback values.
const generateWithRetry = (client, params, retries = 4) =>
  withGeminiRetry(() => client.models.generateContent(params), retries, 2000);

// Values that carry no meaning aren't worth a translation round-trip.
const PLACEHOLDER_VALUES = new Set(['', 'Unknown', 'Unknown methodology']);

/**
 * Pick only the paper fields worth translating. Empty strings, placeholder
 * values, and empty arrays are dropped so we don't ask Gemini to translate
 * "Unknown". Strings are trimmed.
 * @param {{title?:string, abstract?:string, methodology?:string, keyFindings?:string[]}} fields
 * @returns {{title?:string, abstract?:string, methodology?:string, keyFindings?:string[]}}
 */
const filterTranslatableFields = (fields = {}) => {
  const out = {};
  for (const key of ['title', 'abstract', 'methodology']) {
    const val = (fields[key] || '').trim();
    if (val && !PLACEHOLDER_VALUES.has(val)) out[key] = val;
  }
  const findings = Array.isArray(fields.keyFindings)
    ? fields.keyFindings.map((f) => (f || '').trim()).filter(Boolean)
    : [];
  if (findings.length > 0) out.keyFindings = findings;
  return out;
};

/**
 * Translate a paper's readable metadata into Hebrew via Gemini JSON mode.
 * Runs on the ingest client (additional key) to keep chat quota free.
 * Untranslatable/empty fields fall back to their originals.
 * @param {{title?:string, abstract?:string, methodology?:string, keyFindings?:string[]}} fields
 * @returns {Promise<{title:string, abstract:string, methodology:string, keyFindings:string[]}>}
 */
const translateToHebrew = async (fields = {}) => {
  if (!INGEST_KEY) throw new Error('Gemini API key is not configured.');

  const original = {
    title: fields.title || '',
    abstract: fields.abstract || '',
    methodology: fields.methodology || '',
    keyFindings: Array.isArray(fields.keyFindings) ? fields.keyFindings : [],
  };

  const translatable = filterTranslatableFields(fields);
  if (Object.keys(translatable).length === 0) return original;

  try {
    const response = await generateWithRetry(ingestAI, {
      model: MODEL,
      contents: `Translate the JSON values of this academic paper metadata into Hebrew.
Keep the JSON keys and structure identical. Translate naturally and academically.
Keep technical acronyms and named entities (e.g. CNN, RNN, p-value, BERT) as-is where a Hebrew term would be unclear.

${JSON.stringify(translatable)}`,
      config: {
        systemInstruction: 'You are an academic translator. Translate English paper metadata into fluent academic Hebrew, preserving meaning.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            abstract: { type: 'STRING' },
            methodology: { type: 'STRING' },
            keyFindings: { type: 'ARRAY', items: { type: 'STRING' } },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text);
    return {
      title: parsed.title || original.title,
      abstract: parsed.abstract || original.abstract,
      methodology: parsed.methodology || original.methodology,
      keyFindings:
        Array.isArray(parsed.keyFindings) && parsed.keyFindings.length
          ? parsed.keyFindings
          : original.keyFindings,
    };
  } catch (error) {
    console.error('Gemini Translation Error:', error);
    throw new Error('Failed to translate paper');
  }
};

/**
 * Extract structured metadata from raw paper text using Gemini JSON mode.
 * @param {string} paperText Raw text extracted from the PDF
 * @returns {Promise<object>} Structured metadata
 */
const extractPaperMetadata = async (paperText) => {
  try {
    if (!INGEST_KEY) {
      throw new Error('Gemini API key is not configured.');
    }

    // Use the first 25k characters to extract metadata (Abstract, Methodology, etc. are usually at the beginning)
    const contextText = paperText.substring(0, 25000);

    const prompt = `Analyze the following academic paper text and extract the structured metadata.
Make sure the abstract is a concise overview, the methodology is a brief description of their methods,
and key findings contain a few bullet points of what they discovered.

Paper Text Snippet:
${contextText}`;

    const response = await generateWithRetry(ingestAI, {
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: 'You are an academic parser. Extract structured information from the provided paper snippet.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'The title of the paper' },
            abstract: { type: 'STRING', description: 'A concise summary of the abstract (up to 150 words)' },
            authors: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'List of author names extracted from the paper (e.g. ["John Doe", "Jane Smith"])'
            },
            year: { type: 'INTEGER', description: 'The publication year (e.g. 2024). Default to current year if not found.' },
            methodology: { type: 'STRING', description: 'A summary of the methodology used in the study (up to 100 words)' },
            keyFindings: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: '3-5 key findings or results of the study'
            },
            topics: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: '3-4 topic keywords representing this paper (e.g. ["Machine Learning", "NLP"])'
            },
            keywords: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Exactly 20 significant keywords/terms that best characterize this paper (technical terms, methods, concepts). Used to find related papers and drive study questions.'
            }
          },
          required: ['title', 'abstract', 'authors', 'year', 'methodology', 'keyFindings', 'topics', 'keywords']
        }
      }
    });

    const parsedData = JSON.parse(response.text);
    return parsedData;
  } catch (error) {
    console.error('Gemini Metadata Extraction Error:', error);
    // Return standard fallback object if AI parsing fails
    return {
      title: 'Parsed Document',
      abstract: 'Extraction failed. Please review the document.',
      authors: ['Unknown Author'],
      year: new Date().getFullYear(),
      methodology: 'Unknown methodology',
      keyFindings: ['Text parsed successfully'],
      topics: ['General'],
      keywords: []
    };
  }
};

/**
 * Generate a Socratic question grounded in retrieved paper chunks (RAG).
 * Falls back to truncated paperContent if retrieval yields nothing.
 */
const generateSocraticResponse = async (paperId, paperContent, studentMessage, chatHistory = [], keywords = [], language = 'en') => {
  try {
    if (!CHAT_KEY) {
      return "Hello! I am the Socratic Bot. Please configure the Gemini API key to enable my brain.";
    }

    // 1. Retrieve the most relevant chunks for this question (RAG).
    let context = '';
    try {
      const [queryEmbedding] = await embedTexts([studentMessage], CHAT_KEY);
      const hits = await retrieveChunks(paperId, queryEmbedding, TOP_K);
      if (hits.length > 0) {
        context = hits.map((h, i) => `[Excerpt ${i + 1}]\n${h.chunkText}`).join('\n\n');
      }
    } catch (ragErr) {
      console.error('RAG retrieval failed, falling back to full content:', ragErr.message);
    }

    // 2. Fallback: no chunks yet (un-backfilled paper) or retrieval failed.
    if (!context) {
      context = (paperContent || '').substring(0, 120000);
    }

    const focusLine = keywords && keywords.length > 0
      ? `\nKey concepts to probe and assess the student's understanding of: ${keywords.slice(0, 20).join(', ')}.`
      : '';

    // When the UI is in Hebrew, the tutor replies in Hebrew regardless of the
    // language of the paper or the question.
    const languageLine = language === 'he'
      ? '\nRespond ONLY in Hebrew (עברית), even though the paper and question may be in English.'
      : '';

    const systemPrompt = `You are a Socratic tutor guiding a student through reading an academic paper.
Your goal is to encourage critical thinking and deep understanding.
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.
Answer ONLY using the provided context excerpts; if the answer is not in them, say so and guide the student back to the text.
Write in plain prose only. Do NOT use Markdown, LaTeX, or math delimiters (no $...$, \\(...\\), backticks, or asterisks) — write variable names like X, D, C as plain letters.${focusLine}${languageLine}
Context excerpts from the paper:
${context}`;

    const history = chatHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const contents = [
      ...history,
      { role: 'user', parts: [{ text: studentMessage }] },
    ];

    const response = await generateWithRetry(chatAI, {
      model: MODEL,
      contents,
      config: { systemInstruction: systemPrompt },
    });

    return response.text;
  } catch (error) {
    console.error('Gemini Error:', error);
    throw new Error('Failed to generate response from Gemini');
  }
};

/**
 * Judge how well a student demonstrated understanding of a paper from the
 * Socratic conversation. Uses the chat client + JSON mode.
 * @param {string[]} keywords  Paper key concepts to assess against.
 * @param {string} contextExcerpts  Relevant paper text (already truncated).
 * @param {Array<{role:'user'|'model', text:string}>} conversation
 * @returns {Promise<{score:number, level:string, rationale:string}>}
 */
const assessComprehension = async (keywords = [], contextExcerpts = '', conversation = []) => {
  if (!CHAT_KEY) throw new Error('Gemini chat key is not configured.');

  const transcript = conversation
    .map((m) => `${m.role === 'model' ? 'Tutor' : 'Student'}: ${m.text}`)
    .join('\n');

  const prompt = `Assess the STUDENT's demonstrated understanding of this academic paper, based only on what the student said in the conversation.
Key concepts to weigh: ${keywords.slice(0, 20).join(', ') || '(none provided)'}.
Score 0-100: 0 = no understanding shown, 100 = mastery of the key concepts. Be strict; reward correct, specific, on-topic answers and penalize vague, wrong, or off-topic ones.

Paper context:
${(contextExcerpts || '').substring(0, 20000)}

Conversation:
${transcript}`;

  const response = await generateWithRetry(chatAI, {
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: 'You are a strict but fair academic examiner. Return only the requested JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          score: { type: 'INTEGER', description: 'Comprehension score from 0 to 100.' },
          rationale: { type: 'STRING', description: 'One sentence justifying the score.' },
        },
        required: ['score', 'rationale'],
      },
    },
  });

  const parsed = JSON.parse(response.text);
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  return { score, level: scoreToLevel(score), rationale: parsed.rationale || '' };
};

/**
 * Compare papers against a list of criteria using Gemini JSON mode.
 * Difficulty level must be included by the caller as one of the criteria.
 * @param {Array<{_id:any, title:string, abstract?:string, methodology?:string, keywords?:string[]}>} papers
 * @param {string[]} criteria  Criteria names, in display order.
 * @param {string} language    'he' for Hebrew explanations, otherwise English.
 * @returns {Promise<{papers: Array<{paperId:string, scores: Record<string,{score:number, explanation:string}>}>, difficultySummary: string}>}
 */
const comparePapers = async (papers, criteria, language = 'en') => {
  if (!CHAT_KEY) throw new Error('Gemini chat key is not configured.');

  const paperBlocks = papers
    .map((p, i) => `[Paper ${i + 1}] id=${p._id}
Title: ${p.title}
Abstract: ${(p.abstract || '').substring(0, 1500)}
Methodology: ${(p.methodology || 'Unknown').substring(0, 800)}
Keywords: ${(p.keywords || []).slice(0, 20).join(', ')}`)
    .join('\n\n');

  const languageLine = language === 'he'
    ? 'Write every explanation and the difficultySummary in Hebrew.'
    : 'Write every explanation and the difficultySummary in English.';

  const prompt = `Compare the following academic papers against these criteria: ${criteria.join(', ')}.
For each paper, give each criterion a score from 1 to 10 (10 = highest/hardest/most rigorous) with a one-sentence explanation grounded in the paper's abstract, methodology, and keywords.
Also write difficultySummary: 2-3 sentences comparing which paper is the most difficult to read and understand for a student, and why.
${languageLine}

${paperBlocks}`;

  const response = await generateWithRetry(chatAI, {
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: 'You are an academic reviewer producing structured paper comparisons. Return only the requested JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          papers: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                paperId: { type: 'STRING', description: 'The id given in the paper block' },
                scores: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      criterion: { type: 'STRING', description: 'Criterion name exactly as given' },
                      score: { type: 'INTEGER', description: 'Score 1-10' },
                      explanation: { type: 'STRING', description: 'One sentence justifying the score' },
                    },
                    required: ['criterion', 'score', 'explanation'],
                  },
                },
              },
              required: ['paperId', 'scores'],
            },
          },
          difficultySummary: { type: 'STRING', description: '2-3 sentences comparing overall difficulty' },
        },
        required: ['papers', 'difficultySummary'],
      },
    },
  });

  const parsed = JSON.parse(response.text);

  // Normalize: array-of-scores -> map keyed by criterion, clamp scores 1-10.
  const result = (parsed.papers || []).map((p) => {
    const scores = {};
    (p.scores || []).forEach((s) => {
      scores[s.criterion] = {
        score: Math.max(1, Math.min(10, Number(s.score) || 1)),
        explanation: s.explanation || '',
      };
    });
    return { paperId: p.paperId, scores };
  });

  return { papers: result, difficultySummary: parsed.difficultySummary || '' };
};

/**
 * Translate a short piece of text to Hebrew. Returns the original on failure
 * or when no key is configured. Used for the comprehension-score rationale.
 */
const translateStringToHebrew = async (text) => {
  if (!text || !CHAT_KEY) return text;
  try {
    const response = await generateWithRetry(chatAI, {
      model: MODEL,
      contents: `Translate the following text to Hebrew. Return only the Hebrew translation, with no quotes and no extra text.\n\n${text}`,
      config: {
        systemInstruction: 'You are a professional translator. Output only the Hebrew translation of the given text.',
      },
    });
    return (response.text || '').trim() || text;
  } catch (error) {
    console.error('Gemini rationale translation failed:', error.message);
    return text;
  }
};

module.exports = {
  extractPaperMetadata,
  generateSocraticResponse,
  assessComprehension,
  filterTranslatableFields,
  translateToHebrew,
  comparePapers,
  translateStringToHebrew,
};
