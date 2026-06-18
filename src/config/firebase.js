const { initializeApp, cert } = require('firebase-admin/app');

const initializeFirebase = () => {
  try {
    // If you are using a service account JSON file, you can do:
    // const serviceAccount = require('../../serviceAccountKey.json');
    // admin.initializeApp({
    //   credential: admin.credential.cert(serviceAccount)
    // });

    // Or use environment variables
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('Firebase Admin Initialized Successfully');
  } catch (error) {
    console.error('Firebase Admin Initialization Error:', error.message);
  }
};

module.exports = { initializeFirebase };
