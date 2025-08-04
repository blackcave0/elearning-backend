const { verifyFirebaseToken, getFirebaseApp } = require("../config/firebase");
const { query } = require("../config/database");
const logger = require("../utils/logger");

const authenticateUser = async (req, res, next) => {
  try {
    // Check if Firebase is available
    let firebaseApp;
    try {
      firebaseApp = getFirebaseApp();
    } catch (error) {
      firebaseApp = null;
    }

    if (!firebaseApp) {
      // For testing without Firebase, create a mock user
      logger.warn("Firebase not available, using test mode authentication");
      req.user = {
        id: 1,
        firebaseUid: "test-user-uid",
        email: "test@example.com",
        name: "Test User",
        phone: null,
        profileImageUrl: null,
        emailVerified: true,
        isAdmin: false,
      };
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify Firebase token
    const decodedToken = await verifyFirebaseToken(token);

    // Check if user exists in our database, create if not
    let user = await getUserByFirebaseUid(decodedToken.uid);

    if (!user) {
      // Create user in our database
      user = await createUserFromFirebaseToken(decodedToken);
      logger.logAuth("user_created", {
        userId: user.id,
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
      });
    } else {
      // Update last seen timestamp
      await updateUserLastSeen(user.id);
    }

    // Attach user information to request
    req.user = {
      id: user.id,
      firebaseUid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || user.name,
      phone: decodedToken.phone_number || user.phone,
      profileImageUrl: decodedToken.picture || user.profile_image_url,
      emailVerified: decodedToken.email_verified,
      isAdmin: user.is_admin || false,
    };

    logger.logAuth("token_verified", {
      userId: user.id,
      email: decodedToken.email,
    });

    next();
  } catch (error) {
    logger.logSecurity("authentication_failed", {
      error: error.message,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (!req.user.isAdmin) {
    logger.logSecurity("admin_access_denied", {
      userId: req.user.id,
      email: req.user.email,
      ip: req.ip,
    });

    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }

  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    // Check if Firebase is available
    let firebaseApp;
    try {
      firebaseApp = getFirebaseApp();
    } catch (error) {
      firebaseApp = null;
    }

    if (!firebaseApp) {
      // Firebase not available, continue without authentication
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // No token provided, continue without authentication
      return next();
    }

    const token = authHeader.substring(7);
    const decodedToken = await verifyFirebaseToken(token);

    const user = await getUserByFirebaseUid(decodedToken.uid);

    if (user) {
      req.user = {
        id: user.id,
        firebaseUid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name || user.name,
        phone: decodedToken.phone_number || user.phone,
        profileImageUrl: decodedToken.picture || user.profile_image_url,
        emailVerified: decodedToken.email_verified,
        isAdmin: user.is_admin || false,
      };
    }

    next();
  } catch (error) {
    // Continue without user if token is invalid
    logger.logSecurity("optional_auth_failed", {
      error: error.message,
      ip: req.ip,
    });
    next();
  }
};

// Helper functions
const getUserByFirebaseUid = async (firebaseUid) => {
  try {
    const result = await query("SELECT * FROM users WHERE firebase_uid = $1", [
      firebaseUid,
    ]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error("Failed to get user by Firebase UID:", error);
    throw error;
  }
};

const createUserFromFirebaseToken = async (decodedToken) => {
  try {
    const userData = {
      firebase_uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email.split("@")[0],
      phone: decodedToken.phone_number || null,
      profile_image_url: decodedToken.picture || null,
      email_verified: decodedToken.email_verified || false,
    };

    const result = await query(
      `INSERT INTO users (firebase_uid, email, name, phone, profile_image_url, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userData.firebase_uid,
        userData.email,
        userData.name,
        userData.phone,
        userData.profile_image_url,
        userData.email_verified,
      ]
    );

    return result.rows[0];
  } catch (error) {
    logger.error("Failed to create user from Firebase token:", error);
    throw error;
  }
};

const updateUserLastSeen = async (userId) => {
  try {
    await query(
      "UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [userId]
    );
  } catch (error) {
    logger.error("Failed to update user last seen:", error);
    // Don't throw error for last seen update failure
  }
};

// Rate limiting for authentication attempts
const authRateLimit = require("express-rate-limit")({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 failed auth attempts per windowMs
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Don't apply rate limiting if authentication succeeds
    return res.statusCode < 400;
  },
});

module.exports = {
  authenticateUser,
  requireAdmin,
  optionalAuth,
  authRateLimit,
  getUserByFirebaseUid,
  createUserFromFirebaseToken,
};
