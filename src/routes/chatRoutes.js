const express = require('express');
const router = express.Router();
const { createOrGetChat, sendMessage, getUserChats, deleteChat } = require('../controllers/chatController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/chats
router.route('/')
  .post(protect, createOrGetChat)
  .get(protect, getUserChats);

router.route('/:id')
  .delete(protect, deleteChat);

router.post('/:id/messages', protect, sendMessage);

module.exports = router;


