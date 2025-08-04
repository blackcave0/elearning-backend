const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { asyncHandler, createValidationError, createNotFoundError, createForbiddenError } = require('../middleware/errorHandler');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// Get lessons for a course
router.get(
  '/course/:courseId',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const userId = req.user?.id;

    // Check if course exists
    const courseResult = await query(
      'SELECT id, title, is_active FROM courses WHERE id = $1',
      [courseId]
    );

    const course = courseResult.rows[0];
    if (!course) {
      throw createNotFoundError('Course not found');
    }

    if (!course.is_active) {
      throw createNotFoundError('Course is not available');
    }

    // Check if user is enrolled (for authenticated users)
    let isEnrolled = false;
    if (userId) {
      const enrollmentResult = await query(
        'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3',
        [userId, courseId, 'completed']
      );
      isEnrolled = enrollmentResult.rows.length > 0;
    }

    // Get lessons
    let lessonsQuery;
    let queryParams = [courseId];

    if (isEnrolled) {
      // Enrolled users get all lessons with their progress
      lessonsQuery = `
        SELECT 
          l.id,
          l.title,
          l.description,
          l.video_url,
          l.duration_minutes,
          l.order_index,
          l.is_preview,
          l.created_at,
          up.is_completed,
          up.progress_percentage,
          up.time_spent_minutes,
          up.last_accessed_at
        FROM lessons l
        LEFT JOIN user_progress up ON l.id = up.lesson_id AND up.user_id = $2
        WHERE l.course_id = $1
        ORDER BY l.order_index`;
      queryParams.push(userId);
    } else {
      // Non-enrolled users only get preview lessons
      lessonsQuery = `
        SELECT 
          l.id,
          l.title,
          l.description,
          CASE WHEN l.is_preview THEN l.video_url ELSE NULL END as video_url,
          l.duration_minutes,
          l.order_index,
          l.is_preview,
          l.created_at,
          false as is_completed,
          0 as progress_percentage,
          0 as time_spent_minutes,
          NULL as last_accessed_at
        FROM lessons l
        WHERE l.course_id = $1
        ORDER BY l.order_index`;
    }

    const result = await query(lessonsQuery, queryParams);

    res.json({
      success: true,
      data: {
        courseId: course.id,
        courseTitle: course.title,
        isEnrolled,
        lessons: result.rows.map(row => ({
          id: row.id,
          title: row.title,
          description: row.description,
          videoUrl: row.video_url,
          duration: row.duration_minutes,
          order: row.order_index,
          isPreview: row.is_preview,
          isCompleted: row.is_completed || false,
          progressPercentage: parseFloat(row.progress_percentage) || 0,
          timeSpentMinutes: row.time_spent_minutes || 0,
          lastAccessedAt: row.last_accessed_at,
          isLocked: !isEnrolled && !row.is_preview,
          createdAt: row.created_at,
        })),
      },
    });
  })
);

// Get specific lesson details
router.get(
  '/:id',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const lessonId = parseInt(req.params.id);
    const userId = req.user.id;

    // Get lesson details
    const lessonResult = await query(
      `SELECT 
        l.id,
        l.course_id,
        l.title,
        l.description,
        l.video_url,
        l.duration_minutes,
        l.order_index,
        l.is_preview,
        l.created_at,
        c.title as course_title
      FROM lessons l
      JOIN courses c ON l.course_id = c.id
      WHERE l.id = $1`,
      [lessonId]
    );

    const lesson = lessonResult.rows[0];
    if (!lesson) {
      throw createNotFoundError('Lesson not found');
    }

    // Check if user is enrolled in the course or if it's a preview lesson
    const enrollmentResult = await query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3',
      [userId, lesson.course_id, 'completed']
    );

    const isEnrolled = enrollmentResult.rows.length > 0;

    if (!isEnrolled && !lesson.is_preview) {
      throw createForbiddenError('Access denied. Please enroll in the course to access this lesson.');
    }

    // Get user progress for this lesson
    const progressResult = await query(
      'SELECT * FROM user_progress WHERE user_id = $1 AND lesson_id = $2',
      [userId, lessonId]
    );

    const progress = progressResult.rows[0];

    res.json({
      success: true,
      data: {
        id: lesson.id,
        courseId: lesson.course_id,
        courseTitle: lesson.course_title,
        title: lesson.title,
        description: lesson.description,
        videoUrl: lesson.video_url,
        duration: lesson.duration_minutes,
        order: lesson.order_index,
        isPreview: lesson.is_preview,
        isEnrolled,
        createdAt: lesson.created_at,
        progress: progress ? {
          isCompleted: progress.is_completed,
          progressPercentage: parseFloat(progress.progress_percentage),
          timeSpentMinutes: progress.time_spent_minutes,
          lastAccessedAt: progress.last_accessed_at,
          completedAt: progress.completed_at,
        } : {
          isCompleted: false,
          progressPercentage: 0,
          timeSpentMinutes: 0,
          lastAccessedAt: null,
          completedAt: null,
        },
      },
    });
  })
);

// Mark lesson as accessed (for tracking)
router.post(
  '/:id/access',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const lessonId = parseInt(req.params.id);
    const userId = req.user.id;

    // Get lesson and course info
    const lessonResult = await query(
      'SELECT id, course_id, is_preview FROM lessons WHERE id = $1',
      [lessonId]
    );

    const lesson = lessonResult.rows[0];
    if (!lesson) {
      throw createNotFoundError('Lesson not found');
    }

    // Check enrollment or preview access
    const enrollmentResult = await query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3',
      [userId, lesson.course_id, 'completed']
    );

    const isEnrolled = enrollmentResult.rows.length > 0;

    if (!isEnrolled && !lesson.is_preview) {
      throw createForbiddenError('Access denied. Please enroll in the course to access this lesson.');
    }

    // Update or create progress record with last accessed time
    await query(
      `INSERT INTO user_progress (user_id, course_id, lesson_id, last_accessed_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, course_id, lesson_id)
       DO UPDATE SET last_accessed_at = CURRENT_TIMESTAMP`,
      [userId, lesson.course_id, lessonId]
    );

    logger.info('Lesson accessed', {
      userId,
      lessonId,
      courseId: lesson.course_id,
      isPreview: lesson.is_preview,
    });

    res.json({
      success: true,
      message: 'Lesson access recorded',
    });
  })
);

// Get next lesson in course
router.get(
  '/:id/next',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const currentLessonId = parseInt(req.params.id);
    const userId = req.user.id;

    // Get current lesson info
    const currentLessonResult = await query(
      'SELECT course_id, order_index FROM lessons WHERE id = $1',
      [currentLessonId]
    );

    const currentLesson = currentLessonResult.rows[0];
    if (!currentLesson) {
      throw createNotFoundError('Current lesson not found');
    }

    // Check enrollment
    const enrollmentResult = await query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3',
      [userId, currentLesson.course_id, 'completed']
    );

    if (enrollmentResult.rows.length === 0) {
      throw createForbiddenError('Access denied. Please enroll in the course.');
    }

    // Get next lesson
    const nextLessonResult = await query(
      `SELECT id, title, order_index FROM lessons 
       WHERE course_id = $1 AND order_index > $2 
       ORDER BY order_index LIMIT 1`,
      [currentLesson.course_id, currentLesson.order_index]
    );

    const nextLesson = nextLessonResult.rows[0];

    res.json({
      success: true,
      data: nextLesson ? {
        id: nextLesson.id,
        title: nextLesson.title,
        order: nextLesson.order_index,
      } : null,
    });
  })
);

module.exports = router;
