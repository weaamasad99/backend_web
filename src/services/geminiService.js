const { GoogleGenAI } = require('@google/genai');
const { embedTexts, retrieveChunks, TOP_K } = require('./ragService');

// Separate keys isolate bursty ingestion from interactive chat quota.
// Both fall back to the legacy GEMINI_API_KEY for backward compatibility.
const CHAT_KEY = process.env.GEMINI_CHAT_KEY || process.env.GEMINI_API_KEY;
const INGEST_KEY = process.env.GEMINI_INGEST_KEY || process.env.GEMINI_API_KEY;

const chatAI = new GoogleGenAI({ apiKey: CHAT_KEY });
const ingestAI = new GoogleGenAI({ apiKey: INGEST_KEY });

// Free-tier flash model; override with GEMINI_MODEL in .env if needed.
// `gemini-flash-latest` is an always-available alias that avoids the periodic
// 503 "high demand" spikes seen on pinned versions like gemini-2.5-flash.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Retry transient errors (503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED) so a brief
// model overload doesn't silently degrade extraction to fallback values.
const generateWithRetry = async (client, params, retries = 2) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.models.generateContent(params);
    } catch (err) {
      let status = '';
      try { status = JSON.parse(err.message).error?.status; } catch { /* not JSON */ }
      const transient = status === 'UNAVAILABLE' || status === 'RESOURCE_EXHAUSTED';
      if (transient && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
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
const generateSocraticResponse = async (paperId, paperContent, studentMessage, chatHistory = [], keywords = []) => {
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

    const systemPrompt = `You are a Socratic tutor guiding a student through reading an academic paper.
Your goal is to encourage critical thinking and deep understanding.
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.
Answer ONLY using the provided context excerpts; if the answer is not in them, say so and guide the student back to the text.${focusLine}
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

module.exports = {
  extractPaperMetadata,
  generateSocraticResponse,
};
