const User = require('../models/User');
const Paper = require('../models/Paper');

const seedDatabase = async () => {
  try {
    const mockTitles = [
      'Deep Learning Approaches for Natural Language Processing: A Comprehensive Survey',
      'Quantum Computing Applications in Cryptography: Challenges and Opportunities',
      'Climate Change Impact on Marine Biodiversity: A Meta-Analysis',
      'Machine Learning for Medical Diagnosis: A Clinical Trial Study',
      'Renewable Energy Integration in Smart Grids: Optimization Strategies'
    ];

    const deleteResult = await Paper.deleteMany({ title: { $in: mockTitles } });
    if (deleteResult.deletedCount > 0) {
      console.log(`Cleaned up ${deleteResult.deletedCount} mock papers from the database.`);
    }

    const deleteUserResult = await User.deleteMany({ firebaseUid: 'dummy-lecturer-uid' });
    if (deleteUserResult.deletedCount > 0) {
      console.log('Cleaned up dummy lecturer user from the database.');
    }
  } catch (error) {
    console.error('Error cleaning up mock data in seeder:', error.message);
  }
};

module.exports = seedDatabase;
