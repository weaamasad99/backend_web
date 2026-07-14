const Chat = require('../models/Chat');
const Paper = require('../models/Paper');
const User = require('../models/User');
const { generateSocraticResponse, assessComprehension } = require('../services/geminiService');
const { upsertProgress } = require('./progressController');

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
      chat.paper._id,
      chat.paper.content,
      text,
      chatHistory.slice(0, -1), // Exclude the latest message we just added (it's passed as current message)
      chat.paper.keywords || []
    );

    // 4. Save bot message
    const botMessage = { sender: 'bot', text: botResponseText };
    chat.messages.push(botMessage);

    await chat.save();

    // 5. Assess the student's comprehension and persist it. Never block the reply.
    let progress;
    try {
      const conversation = chat.messages.map((m) => ({
        role: m.sender === 'user' ? 'user' : 'model',
        text: m.text,
      }));
      const { score, rationale } = await assessComprehension(
        chat.paper.keywords || [],
        chat.paper.content || '',
        conversation
      );
      progress = await upsertProgress(chat.student, chat.paper._id, score, rationale);
    } catch (assessErr) {
      console.error('Comprehension assessment failed (chat reply still sent):', assessErr.message);
    }

    res.status(200).json({ ...chat.toObject(), progress });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all chats for the logged in user
// @route   GET /api/chats
// @access  Private
const getUserChats = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    const chats = await Chat.find({ student: user._id })
      .populate('paper', 'title abstract authors year')
      .sort({ updatedAt: -1 });

    res.status(200).json(chats);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a chat session
// @route   DELETE /api/chats/:id
// @access  Private
const deleteChat = async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) {
      res.status(404);
      throw new Error('Chat session not found');
    }

    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || chat.student.toString() !== user._id.toString()) {
      res.status(401);
      throw new Error('Not authorized to delete this chat session');
    }

    await Chat.findByIdAndDelete(req.params.id);
    res.json({ message: 'Chat session deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrGetChat,
  sendMessage,
  getUserChats,
  deleteChat,
};


