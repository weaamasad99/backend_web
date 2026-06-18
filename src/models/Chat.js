const mongoose = require('mongoose');

const messageSchema = mongoose.Schema(
  {
    sender: {
      type: String,
      enum: ['user', 'bot'],
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    // Optional: Keep track of the difficulty level if the bot asked a question
    difficulty: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

const chatSchema = mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    paper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Paper',
      required: true,
    },
    messages: [messageSchema],
    // State of the chat: active, completed, etc.
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Chat', chatSchema);
