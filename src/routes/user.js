const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { asyncHandler, createValidationError, createNotFoundError } = require('../middleware/errorHandler');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// Get user enrollments
router.get(
  '/enrollments',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT 
        e.id,
        e.course_id,
        e.payment_status,
        e.enrolled_at,
        e.payment_completed_at,
        c.title,
        c.description,
        c.image_url,
        c.instructor,
        c.price,
        c.rating,
        c.total_lessons,
        c.duration_minutes,
        c.level,
        cat.name as category_name
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE e.user_id = $1 AND e.payment_status = 'completed'
      ORDER BY e.enrolled_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) FROM enrollments WHERE user_id = $1 AND payment_status = $2',
      [userId, 'completed']
    );

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        enrollments: result.rows.map(row => ({
          id: row.id,
          courseId: row.course_id,
          paymentStatus: row.payment_status,
          enrolledAt: row.enrolled_at,
          paymentCompletedAt: row.payment_completed_at,
          course: {
            id: row.course_id,
            title: row.title,
            description: row.description,
            imageUrl: row.image_url,
            instructor: row.instructor,
            price: parseFloat(row.price),
            rating: parseFloat(row.rating),
            totalLessons: row.total_lessons,
            duration: row.duration_minutes,
            level: row.level,
            category: row.category_name,
          },
        })),
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  })
);

// Get user progress for a specific course
router.get(
  '/progress/:courseId',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const courseId = parseInt(req.params.courseId);

    // Check if user is enrolled in the course
    const enrollmentResult = await query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3',
      [userId, courseId, 'completed']
    );

    if (enrollmentResult.rows.length === 0) {
      throw createNotFoundError('Course enrollment not found');
    }

    // Get course details
    const courseResult = await query(
      'SELECT id, title, total_lessons FROM courses WHERE id = $1',
      [courseId]
    );

    const course = courseResult.rows[0];
    if (!course) {
      throw createNotFoundError('Course not found');
    }

    // Get user progress for all lessons in the course
    const progressResult = await query(
      `SELECT 
        up.lesson_id,
        up.is_completed,
        up.progress_percentage,
        up.time_spent_minutes,
        up.last_accessed_at,
        up.completed_at,
        l.title as lesson_title,
        l.order_index
      FROM user_progress up
      JOIN lessons l ON up.lesson_id = l.id
      WHERE up.user_id = $1 AND up.course_id = $2
      ORDER BY l.order_index`,
      [userId, courseId]
    );

    // Calculate overall progress
    const totalLessons = course.total_lessons;
    const completedLessons = progressResult.rows.filter(row => row.is_completed).length;
    const overallProgress = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
    const totalTimeSpent = progressResult.rows.reduce((sum, row) => sum + (row.time_spent_minutes || 0), 0);

    res.json({
      success: true,
      data: {
        courseId: course.id,
        courseTitle: course.title,
        totalLessons: totalLessons,
        completedLessons: completedLessons,
        overallProgress: Math.round(overallProgress * 100) / 100,
        totalTimeSpent: totalTimeSpent,
        lessons: progressResult.rows.map(row => ({
          lessonId: row.lesson_id,
          lessonTitle: row.lesson_title,
          orderIndex: row.order_index,
          isCompleted: row.is_completed,
          progressPercentage: parseFloat(row.progress_percentage),
          timeSpentMinutes: row.time_spent_minutes,
          lastAccessedAt: row.last_accessed_at,
          completedAt: row.completed_at,
        })),
      },
    });
  })
);

// Update lesson progress
router.put(
  '/progress/:courseId/:lessonId',
  authenticateUser,
  [
    body('progressPercentage').isFloat({ min: 0, max: 100 }).withMessage('Progress percentage must be between 0 and 100'),
    body('timeSpentMinutes').optional().isInt({ min: 0 }).withMessage('Time spent must be a positive integer'),
    body('isCompleted').optional().isBoolean().withMessage('isCompleted must be a boolean'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createValidationError('Validation failed', errors.array());
    }

    const userId = req.user.id;
    const courseId = parseInt(req.params.courseId);
    const lessonId = parseInt(req.params.lessonId);
    const { progressPercentage, timeSpentMinutes, isCompleted } = req.body;

    // Check if user is enrolled in the course
    const enrollmentResult = await query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3',
      [userId, courseId, 'completed']
    );

    if (enrollmentResult.rows.length === 0) {
      throw createNotFoundError('Course enrollment not found');
    }

    // Update or insert progress record
    const result = await query(
      `INSERT INTO user_progress (user_id, course_id, lesson_id, progress_percentage, time_spent_minutes, is_completed, last_accessed_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7)
       ON CONFLICT (user_id, course_id, lesson_id)
       DO UPDATE SET
         progress_percentage = $4,
         time_spent_minutes = COALESCE(user_progress.time_spent_minutes, 0) + COALESCE($5, 0),
         is_completed = $6,
         last_accessed_at = CURRENT_TIMESTAMP,
         completed_at = CASE WHEN $6 = true AND user_progress.completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE user_progress.completed_at END
       RETURNING *`,
      [
        userId,
        courseId,
        lessonId,
        progressPercentage,
        timeSpentMinutes || 0,
        isCompleted || (progressPercentage >= 100),
        isCompleted && progressPercentage >= 100 ? new Date() : null,
      ]
    );

    const updatedProgress = result.rows[0];

    logger.info('User progress updated', {
      userId,
      courseId,
      lessonId,
      progressPercentage,
      isCompleted: updatedProgress.is_completed,
    });

    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: {
        lessonId: updatedProgress.lesson_id,
        progressPercentage: parseFloat(updatedProgress.progress_percentage),
        timeSpentMinutes: updatedProgress.time_spent_minutes,
        isCompleted: updatedProgress.is_completed,
        lastAccessedAt: updatedProgress.last_accessed_at,
        completedAt: updatedProgress.completed_at,
      },
    });
  })
);

module.exports = router;
