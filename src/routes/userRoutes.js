const express = require('express');
const router = express.Router();
const { 
  loginUser, 
  registerUser, 
  getUserProfile, 
  forgotPassword, 
  updateUserProfile, 
  getStudents,
  searchLecturer,
  requestSupervisor,
  acceptStudent,
  rejectStudent,
  cancelSupervisorRequest,
  setComparisonCriteria
} = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');

// Route: /api/users
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/forgot-password', authLimiter, forgotPassword);
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);
router.get('/students', protect, getStudents);

// Supervisor Routes
router.get('/search-lecturer', protect, searchLecturer);
router.post('/request-supervisor', protect, requestSupervisor);
router.put('/accept-student/:id', protect, acceptStudent);
router.put('/reject-student/:id', protect, rejectStudent);
router.delete('/cancel-supervisor-request/:lecturerId', protect, cancelSupervisorRequest);
router.put('/comparison-criteria', protect, setComparisonCriteria);

module.exports = router;
