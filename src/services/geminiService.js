const { GoogleGenAI } = require('@google/genai');

// Note: Ensure GEMINI_API_KEY is set in your .env file.
// Get a free key at https://aistudio.google.com/apikey
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Free-tier flash model; override with GEMINI_MODEL in .env if needed
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Generate a Socratic question based on the student's message and the paper context.
 * @param {string} paperContent The text of the paper
 * studentMessage The last message from the student
 * @param {Array} chatHistory Previous chat messages
 * @returns {Promise<string>} The bot's response/question
 */
const generateSocraticResponse = async (paperContent, studentMessage, chatHistory = []) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return "Hello! I am the Socratic Bot. Please configure the Gemini API key to enable my brain.";
    }

    const systemPrompt = `You are a Socratic tutor guiding a student through reading an academic paper.
Your goal is to encourage critical thinking and deep understanding.
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.
Paper Context: ${paperContent.substring(0, 2000)}...`; // Truncated for token limits in this example

    // Gemini uses roles 'user' and 'model' (not 'assistant') and a parts[] shape
    const history = chatHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const contents = [
      ...history,
      { role: 'user', parts: [{ text: studentMessage }] },
    ];

    const response = await ai.models.generateContent({
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
  generateSocraticResponse,
};
