const User = require('../models/User');
const Paper = require('../models/Paper');
const Chat = require('../models/Chat');
const { getAuth } = require('firebase-admin/auth');
const axios = require('axios');

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res, next) => {
  try {
    const { email, username, password, name, role, institution } = req.body;

    if (!email || !username || !password || !name) {
      res.status(400);
      throw new Error('Please provide all required fields (email, username, password, name)');
    }

    // Check if username already exists in MongoDB
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      res.status(400);
      throw new Error('Username is already taken');
    }

    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: name,
    });

    // 2. Save user in MongoDB
    const user = await User.create({
      firebaseUid: userRecord.uid,
      username: username,
      email: userRecord.email,
      name: userRecord.displayName || name,
      role: role || 'student', // default role
      institution: institution || '',
    });

    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      res.status(400);
      throw new Error('Please provide email/username and password');
    }

    let loginEmail = identifier;

    // Check if identifier is a username (doesn't contain '@')
    if (!identifier.includes('@')) {
      const userDoc = await User.findOne({ username: identifier });
      if (!userDoc) {
        res.status(404);
        throw new Error('User not found');
      }
      loginEmail = userDoc.email;
    }

    // 1. Authenticate with Firebase REST API
    const apiKey = process.env.FIREBASE_API_KEY;
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    let response;
    try {
      response = await axios.post(authUrl, {
        email: loginEmail,
        password,
        returnSecureToken: true
      });
    } catch (err) {
      res.status(401);
      throw new Error('Invalid email/username or password');
    }

    const { idToken, localId } = response.data;

    // 2. Fetch user from MongoDB
    const user = await User.findOne({ firebaseUid: localId });

    if (!user) {
      res.status(404);
      throw new Error('User not found in database');
    }

    res.status(200).json({
      token: idToken,
      user
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // Lazy migration: fold the legacy single-supervisor fields into the
    // supervisors array so older documents keep their relationship.
    if (user.supervisor && ['pending', 'approved'].includes(user.supervisorStatus)) {
      const exists = user.supervisors.some(
        (s) => s.lecturer.toString() === user.supervisor.toString()
      );
      if (!exists) {
        user.supervisors.push({ lecturer: user.supervisor, status: user.supervisorStatus });
      }
      user.supervisor = null;
      user.supervisorStatus = 'none';
      await user.save();
    }

    await user.populate('supervisors.lecturer', 'name email institution');
    res.json(user);
  } catch (error) {
    next(error);
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (user) {
      user.name = req.body.name || user.name;
      user.institution = req.body.institution !== undefined ? req.body.institution : user.institution;
      // Preferences — only overwrite when the client sends a value.
      if (req.body.researchField !== undefined) user.researchField = req.body.researchField;
      if (req.body.citationFormat !== undefined) user.citationFormat = req.body.citationFormat;
      if (req.body.defaultDepth !== undefined) user.defaultDepth = req.body.defaultDepth;

      const updatedUser = await user.save();
      res.json({
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } else {
      res.status(404);
      throw new Error('User not found');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Get all students for lecturer dashboard
// @route   GET /api/users/students
// @access  Private (Lecturer only)
const getStudents = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user || user.role !== 'lecturer') {
      res.status(403);
      throw new Error('Not authorized as a lecturer');
    }

    const students = await User.find({
      role: 'student',
      $or: [
        { supervisors: { $elemMatch: { lecturer: user._id, status: { $in: ['pending', 'approved'] } } } },
        // Legacy documents not yet migrated to the supervisors array
        { supervisor: user._id, supervisorStatus: { $in: ['pending', 'approved'] } },
      ],
    }).select('-firebaseUid -__v');

    const studentData = await Promise.all(students.map(async (student) => {
      const papersCount = await Paper.countDocuments({ uploadedBy: student._id });
      const chats = await Chat.find({ student: student._id }).sort({ updatedAt: -1 }).limit(1);
      const lastActive = chats.length > 0 ? chats[0].updatedAt : student.updatedAt;

      // Format date
      const date = new Date(lastActive);
      const now = new Date();
      const diffMs = now - date;
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHrs / 24);
      let lastActiveStr = 'Just now';
      if (diffDays > 0) {
        lastActiveStr = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
      } else if (diffHrs > 0) {
        lastActiveStr = `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
      }

      // Status of THIS lecturer's relationship with the student (array entry,
      // falling back to the legacy single-supervisor fields).
      const entry = student.supervisors.find((s) => s.lecturer.toString() === user._id.toString());
      const relationStatus = entry ? entry.status : student.supervisorStatus;

      return {
        id: student._id,
        name: student.name,
        email: student.email,
        project: student.institution || 'Final Project',
        papersAnalyzed: papersCount,
        lastActive: lastActiveStr,
        status: relationStatus === 'pending' ? 'Pending' : (papersCount > 0 ? 'Active' : 'Review Needed'),
      };
    }));

    res.json(studentData);
  } catch (error) {
    next(error);
  }
};

// @desc    Forgot password
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      res.status(400);
      throw new Error('Please provide email or username');
    }

    let resetEmail = identifier;

    // If it's a username, find the email
    if (!identifier.includes('@')) {
      const userDoc = await User.findOne({ username: identifier });
      if (!userDoc) {
        res.status(404);
        throw new Error('User not found');
      }
      resetEmail = userDoc.email;
    }

    const apiKey = process.env.FIREBASE_API_KEY;
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;

    try {
      await axios.post(authUrl, {
        requestType: 'PASSWORD_RESET',
        email: resetEmail
      });
      res.status(200).json({ message: 'Password reset email sent successfully' });
    } catch (err) {
      res.status(500);
      throw new Error('Failed to send password reset email');
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Search for a lecturer by email
// @route   GET /api/users/search-lecturer
// @access  Private (Student)
const searchLecturer = async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email) {
      res.status(400);
      throw new Error('Please provide an email to search');
    }

    const lecturer = await User.findOne({ email, role: 'lecturer' }).select('name email institution');
    
    if (!lecturer) {
      res.status(404);
      throw new Error('Lecturer not found with that email');
    }

    res.json(lecturer);
  } catch (error) {
    next(error);
  }
};

// @desc    Student requests a lecturer as supervisor
// @route   POST /api/users/request-supervisor
// @access  Private (Student)
const requestSupervisor = async (req, res, next) => {
  try {
    const { lecturerId } = req.body;
    
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== 'student') {
      res.status(403);
      throw new Error('Not authorized as a student');
    }

    const lecturer = await User.findById(lecturerId);
    if (!lecturer || lecturer.role !== 'lecturer') {
      res.status(404);
      throw new Error('Lecturer not found');
    }

    const already = user.supervisors.find((s) => s.lecturer.toString() === lecturer._id.toString());
    if (already) {
      res.status(409);
      throw new Error(
        already.status === 'approved'
          ? 'This lecturer already supervises you'
          : 'You already have a pending request to this lecturer'
      );
    }

    user.supervisors.push({ lecturer: lecturer._id, status: 'pending' });
    await user.save();

    res.json({ message: 'Request sent successfully', supervisorStatus: 'pending' });
  } catch (error) {
    next(error);
  }
};

// @desc    Lecturer accepts a student's request
// @route   PUT /api/users/accept-student/:id
// @access  Private (Lecturer)
const acceptStudent = async (req, res, next) => {
  try {
    const lecturer = await User.findOne({ firebaseUid: req.user.uid });
    if (!lecturer || lecturer.role !== 'lecturer') {
      res.status(403);
      throw new Error('Not authorized as a lecturer');
    }

    const student = await User.findById(req.params.id);
    if (!student || student.role !== 'student') {
      res.status(404);
      throw new Error('Student not found');
    }

    const entry = student.supervisors.find((s) => s.lecturer.toString() === lecturer._id.toString());
    if (!entry) {
      res.status(403);
      throw new Error('Student did not request you as a supervisor');
    }

    entry.status = 'approved';
    await student.save();

    res.json({ message: 'Student approved successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Lecturer rejects a student's request
// @route   PUT /api/users/reject-student/:id
// @access  Private (Lecturer)
const rejectStudent = async (req, res, next) => {
  try {
    const lecturer = await User.findOne({ firebaseUid: req.user.uid });
    if (!lecturer || lecturer.role !== 'lecturer') {
      res.status(403);
      throw new Error('Not authorized as a lecturer');
    }

    const student = await User.findById(req.params.id);
    if (!student || student.role !== 'student') {
      res.status(404);
      throw new Error('Student not found');
    }

    const entryIndex = student.supervisors.findIndex((s) => s.lecturer.toString() === lecturer._id.toString());
    if (entryIndex === -1) {
      res.status(403);
      throw new Error('Student did not request you as a supervisor');
    }

    student.supervisors.splice(entryIndex, 1);
    await student.save();

    res.json({ message: 'Student rejected successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Lecturer saves their paper-comparison criteria
// @route   PUT /api/users/comparison-criteria
// @access  Private (Lecturer)
const setComparisonCriteria = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== 'lecturer') {
      res.status(403);
      throw new Error('Not authorized as a lecturer');
    }

    const { criteria } = req.body;
    if (!Array.isArray(criteria)) {
      res.status(400);
      throw new Error('criteria (array of strings) is required');
    }

    const cleaned = criteria
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0)
      .slice(0, 20);

    // Targeted update ($set) instead of user.save() — full-document validation
    // would fail on legacy accounts missing a now-required field (e.g. username).
    await User.updateOne({ _id: user._id }, { $set: { comparisonCriteria: cleaned } });

    res.json({ message: 'Criteria saved successfully', comparisonCriteria: cleaned });
  } catch (error) {
    next(error);
  }
};

// @desc    Student cancels their own pending supervision request
// @route   DELETE /api/users/cancel-supervisor-request/:lecturerId
// @access  Private (Student)
const cancelSupervisorRequest = async (req, res, next) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== 'student') {
      res.status(403);
      throw new Error('Not authorized as a student');
    }

    const entryIndex = user.supervisors.findIndex(
      (s) => s.lecturer.toString() === req.params.lecturerId
    );
    if (entryIndex === -1) {
      res.status(404);
      throw new Error('No request to this lecturer');
    }
    if (user.supervisors[entryIndex].status !== 'pending') {
      res.status(403);
      throw new Error('Only pending requests can be cancelled');
    }

    user.supervisors.splice(entryIndex, 1);
    await user.save();

    res.json({ message: 'Request cancelled successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  getStudents,
  forgotPassword,
  searchLecturer,
  requestSupervisor,
  acceptStudent,
  rejectStudent,
  cancelSupervisorRequest,
  setComparisonCriteria,
};
