const Anthropic = require('@anthropic-ai/sdk');

// Note: Ensure ANTHROPIC_API_KEY is set in your .env file
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate a Socratic question based on the student's message and the paper context.
 * @param {string} paperContent The text of the paper
 * studentMessage The last message from the student
 * @param {Array} chatHistory Previous chat messages
 * @returns {Promise<string>} The bot's response/question
 */
const generateSocraticResponse = async (paperContent, studentMessage, chatHistory = []) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return "Hello! I am the Socratic Bot. Please configure the Anthropic API key to enable my brain.";
    }

    const systemPrompt = `You are a Socratic tutor guiding a student through reading an academic paper.
Your goal is to encourage critical thinking and deep understanding.
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.
Paper Context: ${paperContent.substring(0, 2000)}...`; // Truncated for token limits in this example

    const messages = [
      ...chatHistory,
      { role: 'user', content: studentMessage },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    // response.content is an array of blocks; collect the text blocks
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  } catch (error) {
    console.error('Anthropic Error:', error);
    throw new Error('Failed to generate response from Claude');
  }
};

module.exports = {
  generateSocraticResponse,
};
