const { GoogleGenAI } = require('@google/genai');

// Note: Ensure GEMINI_API_KEY is set in your .env file.
// Get a free key at https://aistudio.google.com/apikey
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Free-tier flash model; override with GEMINI_MODEL in .env if needed.
// `gemini-flash-latest` is an always-available alias that avoids the periodic
// 503 "high demand" spikes seen on pinned versions like gemini-2.5-flash.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Retry transient errors (503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED) so a brief
// model overload doesn't silently degrade extraction to fallback values.
const generateWithRetry = async (params, retries = 2) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
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
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Gemini API key is not configured.');
    }

    // Use the first 25k characters to extract metadata (Abstract, Methodology, etc. are usually at the beginning)
    const contextText = paperText.substring(0, 25000);

    const prompt = `Analyze the following academic paper text and extract the structured metadata.
Make sure the abstract is a concise overview, the methodology is a brief description of their methods,
and key findings contain a few bullet points of what they discovered.

Paper Text Snippet:
${contextText}`;

    const response = await generateWithRetry({
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
 * Generate a Socratic question based on the student's message and the paper context.
 * @param {string} paperContent The text of the paper
 * studentMessage The last message from the student
 * @param {Array} chatHistory Previous chat messages
 * @returns {Promise<string>} The bot's response/question
 */
const generateSocraticResponse = async (paperContent, studentMessage, chatHistory = [], keywords = []) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return "Hello! I am the Socratic Bot. Please configure the Gemini API key to enable my brain.";
    }

    // The PDF-derived keywords steer which concepts the tutor probes, and let it
    // gauge the student's grasp of the paper's core terms.
    const focusLine = keywords && keywords.length > 0
      ? `\nKey concepts to probe and assess the student's understanding of: ${keywords.slice(0, 20).join(', ')}.`
      : '';

    const systemPrompt = `You are a Socratic tutor guiding a student through reading an academic paper.
Your goal is to encourage critical thinking and deep understanding.
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.${focusLine}
Paper Context: ${paperContent.substring(0, 120000)}...`; // Substantially increased from 2000 for full paper comprehension

    // Gemini uses roles 'user' and 'model' (not 'assistant') and a parts[] shape
    const history = chatHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const contents = [
      ...history,
      { role: 'user', parts: [{ text: studentMessage }] },
    ];

    const response = await generateWithRetry({
      model: MODEL,
      contents: contents,
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
