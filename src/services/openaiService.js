const OpenAI = require('openai');

// Note: Ensure OPENAI_API_KEY is set in your .env file
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key', // prevent crash if not set
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
    if (!process.env.OPENAI_API_KEY) {
      return "Hello! I am the Socratic Bot. Please configure the OpenAI API key to enable my brain.";
    }

    const messages = [
      {
        role: 'system',
        content: `You are a Socratic tutor guiding a student through reading an academic paper. 
Your goal is to encourage critical thinking and deep understanding. 
Do not give direct answers immediately. Instead, ask guiding questions tailored to the student's level of understanding.
Paper Context: ${paperContent.substring(0, 2000)}...`, // Truncated for token limits in this example
      },
      ...chatHistory,
      { role: 'user', content: studentMessage },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 150,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Error:', error);
    throw new Error('Failed to generate response from OpenAI');
  }
};

module.exports = {
  generateSocraticResponse,
};
