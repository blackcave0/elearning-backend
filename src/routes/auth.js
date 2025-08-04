const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticateUser, optionalAuth } = require("../middleware/auth");
const {
  asyncHandler,
  createValidationError,
  createNotFoundError,
} = require("../middleware/errorHandler");
const { query } = require("../config/database");
const logger = require("../utils/logger");

const router = express.Router();

// Get current user profile
router.get(
  "/profile",
  authenticateUser,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const result = await query(
      "SELECT id, firebase_uid, email, name, phone, profile_image_url, email_verified, is_admin, created_at, updated_at FROM users WHERE id = $1",
      [userId]
    );

    const user = result.rows[0];
    if (!user) {
      throw createNotFoundError("User not found");
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        email: user.email,
        name: user.name,
        phone: user.phone,
        profileImageUrl: user.profile_image_url,
        emailVerified: user.email_verified,
        isAdmin: user.is_admin,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  })
);

// Update user profile
router.put(
  "/profile",
  authenticateUser,
  [
    body("name")
      .optional()
      .isLength({ min: 1, max: 255 })
      .withMessage("Name must be between 1 and 255 characters"),
    body("phone")
      .optional()
      .isMobilePhone()
      .withMessage("Invalid phone number format"),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createValidationError("Validation failed", errors.array());
    }

    const userId = req.user.id;
    const { name, phone } = req.body;

    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount}`);
      updateValues.push(name);
      paramCount++;
    }

    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCount}`);
      updateValues.push(phone);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.json({
        success: true,
        message: "No changes to update",
      });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(userId);

    const result = await query(
      `UPDATE users SET ${updateFields.join(", ")} WHERE id = $${paramCount} RETURNING id, firebase_uid, email, name, phone, profile_image_url, email_verified, is_admin, created_at, updated_at`,
      updateValues
    );

    const user = result.rows[0];

    logger.logAuth("profile_updated", {
      userId: user.id,
      email: user.email,
      updatedFields: Object.keys(req.body),
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: user.id,
        firebaseUid: user.firebase_uid,
        email: user.email,
        name: user.name,
        phone: user.phone,
        profileImageUrl: user.profile_image_url,
        emailVerified: user.email_verified,
        isAdmin: user.is_admin,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  })
);

// Delete user account
router.delete(
  "/account",
  authenticateUser,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const firebaseUid = req.user.firebaseUid;

    // Delete user from database (this will cascade delete related records)
    await query("DELETE FROM users WHERE id = $1", [userId]);

    logger.logAuth("account_deleted", {
      userId,
      firebaseUid,
      email: req.user.email,
    });

    res.json({
      success: true,
      message: "Account deleted successfully",
    });
  })
);

// Verify authentication status
router.get(
  "/verify",
  authenticateUser,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      message: "Token is valid",
      data: {
        userId: req.user.id,
        email: req.user.email,
        name: req.user.name,
        isAdmin: req.user.isAdmin,
      },
    });
  })
);

module.exports = router;
