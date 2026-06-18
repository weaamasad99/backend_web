const express = require('express');
const router = express.Router();
const { createOrGetChat, sendMessage } = require('../controllers/chatController');
const { protect } = require('../middlewares/authMiddleware');

// Route: /api/chats
router.post('/', protect, createOrGetChat);
router.post('/:id/messages', protect, sendMessage);

module.exports = router;
