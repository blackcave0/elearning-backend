const admin = require("firebase-admin");
const path = require("path");
const logger = require("../utils/logger");

let firebaseApp = null;

const initializeFirebase = () => {
  try {
    if (!firebaseApp) {
      const serviceAccountPath = process.env.FIREBASE_ADMIN_SDK_PATH;

      if (!serviceAccountPath) {
        logger.warn(
          "FIREBASE_ADMIN_SDK_PATH environment variable is not set. Firebase features will be disabled."
        );
        return null;
      }

      // Check if the service account file exists
      try {
        const serviceAccount = require(path.resolve(serviceAccountPath));

        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });

        logger.info("Firebase Admin SDK initialized successfully");
      } catch (fileError) {
        logger.warn(
          "Firebase Admin SDK file not found. Firebase features will be disabled.",
          {
            path: serviceAccountPath,
            error: fileError.message,
          }
        );
        return null;
      }
    }

    return firebaseApp;
  } catch (error) {
    logger.error("Failed to initialize Firebase Admin SDK:", error);
    return null; // Don't throw, just return null to allow server to start
  }
};

const getFirebaseApp = () => {
  if (!firebaseApp) {
    throw new Error(
      "Firebase not initialized. Call initializeFirebase() first."
    );
  }
  return firebaseApp;
};

const verifyFirebaseToken = async (idToken) => {
  try {
    const app = getFirebaseApp();
    const decodedToken = await app.auth().verifyIdToken(idToken);

    logger.debug("Firebase token verified successfully", {
      uid: decodedToken.uid,
      email: decodedToken.email,
    });

    return decodedToken;
  } catch (error) {
    logger.error("Firebase token verification failed:", error);
    throw new Error("Invalid or expired token");
  }
};

const getUserByUid = async (uid) => {
  try {
    const app = getFirebaseApp();
    const userRecord = await app.auth().getUser(uid);
    return userRecord;
  } catch (error) {
    logger.error("Failed to get user by UID:", error);
    throw error;
  }
};

const createCustomToken = async (uid, additionalClaims = {}) => {
  try {
    const app = getFirebaseApp();
    const customToken = await app
      .auth()
      .createCustomToken(uid, additionalClaims);
    return customToken;
  } catch (error) {
    logger.error("Failed to create custom token:", error);
    throw error;
  }
};

const setCustomUserClaims = async (uid, customClaims) => {
  try {
    const app = getFirebaseApp();
    await app.auth().setCustomUserClaims(uid, customClaims);
    logger.info("Custom user claims set successfully", { uid, customClaims });
  } catch (error) {
    logger.error("Failed to set custom user claims:", error);
    throw error;
  }
};

const deleteUser = async (uid) => {
  try {
    const app = getFirebaseApp();
    await app.auth().deleteUser(uid);
    logger.info("User deleted successfully", { uid });
  } catch (error) {
    logger.error("Failed to delete user:", error);
    throw error;
  }
};

const listUsers = async (nextPageToken = undefined, maxResults = 1000) => {
  try {
    const app = getFirebaseApp();
    const listUsersResult = await app
      .auth()
      .listUsers(maxResults, nextPageToken);
    return {
      users: listUsersResult.users,
      pageToken: listUsersResult.pageToken,
    };
  } catch (error) {
    logger.error("Failed to list users:", error);
    throw error;
  }
};

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  verifyFirebaseToken,
  getUserByUid,
  createCustomToken,
  setCustomUserClaims,
  deleteUser,
  listUsers,
};
