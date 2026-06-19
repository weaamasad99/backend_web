const Chat = require('../models/Chat');
const Paper = require('../models/Paper');
const User = require('../models/User');
const { generateSocraticResponse } = require('../services/claudeService');

// @desc    Start or resume a chat for a paper
// @route   POST /api/chats
// @access  Private
const createOrGetChat = async (req, res, next) => {
  try {
    const { paperId } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    let chat = await Chat.findOne({ student: user._id, paper: paperId });

    if (!chat) {
      chat = await Chat.create({
        student: user._id,
        paper: paperId,
        messages: [],
      });
    }

    res.status(200).json(chat);
  } catch (error) {
    next(error);
  }
};

// @desc    Send a message to the Socratic bot
// @route   POST /api/chats/:id/messages
// @access  Private
const sendMessage = async (req, res, next) => {
  try {
    const { text } = req.body;
    const chatId = req.params.id;

    const chat = await Chat.findById(chatId).populate('paper');

    if (!chat) {
      res.status(404);
      throw new Error('Chat not found');
    }

    // 1. Save user message
    const userMessage = { sender: 'user', text };
    chat.messages.push(userMessage);

    // 2. Prepare chat history for OpenAI
    const chatHistory = chat.messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));

    // 3. Get bot response
    const botResponseText = await generateSocraticResponse(
      chat.paper.content,
      text,
      chatHistory.slice(0, -1) // Exclude the latest message we just added (it's passed as current message)
    );

    // 4. Save bot message
    const botMessage = { sender: 'bot', text: botResponseText };
    chat.messages.push(botMessage);

    await chat.save();

    res.status(200).json(chat);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrGetChat,
  sendMessage,
};
