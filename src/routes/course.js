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

// Get all courses with pagination and filters
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const category = req.query.category;
    const level = req.query.level;
    const search = req.query.search;
    const featured = req.query.featured === "true";
    const popular = req.query.popular === "true";

    let whereConditions = ["c.is_active = true"];
    let queryParams = [];
    let paramCount = 1;

    if (category) {
      whereConditions.push(`cat.name ILIKE $${paramCount}`);
      queryParams.push(`%${category}%`);
      paramCount++;
    }

    if (level) {
      whereConditions.push(`c.level = $${paramCount}`);
      queryParams.push(level);
      paramCount++;
    }

    if (search) {
      whereConditions.push(
        `(c.title ILIKE $${paramCount} OR c.description ILIKE $${paramCount})`
      );
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    if (featured) {
      whereConditions.push("c.is_featured = true");
    }

    if (popular) {
      whereConditions.push("c.is_popular = true");
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    queryParams.push(limit, offset);

    const result = await query(
      `SELECT 
        c.id,
        c.title,
        c.description,
        c.image_url,
        c.instructor,
        c.price,
        c.rating,
        c.total_lessons,
        c.duration_minutes,
        c.level,
        c.is_featured,
        c.is_popular,
        c.created_at,
        c.updated_at,
        cat.name as category_name,
        cat.color as category_color
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      queryParams
    );

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) FROM courses c
       LEFT JOIN categories cat ON c.category_id = cat.id
       ${whereClause}`,
      queryParams.slice(0, -2) // Remove limit and offset
    );

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        courses: result.rows.map((row) => ({
          id: row.id,
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
          categoryColor: row.category_color,
          isFeatured: row.is_featured,
          isPopular: row.is_popular,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
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

// Get all categories (must be before /:id route)
router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT
        id,
        name,
        description,
        icon_name,
        color,
        is_popular,
        created_at,
        (SELECT COUNT(*) FROM courses WHERE category_id = categories.id AND is_active = true) as course_count
      FROM categories
      ORDER BY is_popular DESC, name ASC`
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        iconName: row.icon_name,
        color: row.color,
        isPopular: row.is_popular,
        courseCount: parseInt(row.course_count) || 0,
        createdAt: row.created_at,
      })),
    });
  })
);

// Get featured courses (must be before /:id route)
router.get(
  "/featured",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 6;

    const result = await query(
      `SELECT
        c.id,
        c.title,
        c.description,
        c.image_url,
        c.instructor,
        c.price,
        c.rating,
        c.total_lessons,
        c.duration_minutes,
        c.level,
        cat.name as category_name,
        cat.color as category_color
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.is_featured = true AND c.is_active = true
      ORDER BY c.created_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
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
        categoryColor: row.category_color,
      })),
    });
  })
);

// Get popular courses (must be before /:id route)
router.get(
  "/popular",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit) || 6;

    const result = await query(
      `SELECT
        c.id,
        c.title,
        c.description,
        c.image_url,
        c.instructor,
        c.price,
        c.rating,
        c.total_lessons,
        c.duration_minutes,
        c.level,
        cat.name as category_name,
        cat.color as category_color
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.is_popular = true AND c.is_active = true
      ORDER BY c.rating DESC, c.created_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
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
        categoryColor: row.category_color,
      })),
    });
  })
);

// Get course by ID
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const courseId = parseInt(req.params.id);
    const userId = req.user?.id;

    const result = await query(
      `SELECT 
        c.id,
        c.title,
        c.description,
        c.image_url,
        c.instructor,
        c.price,
        c.rating,
        c.total_lessons,
        c.duration_minutes,
        c.level,
        c.tags,
        c.is_featured,
        c.is_popular,
        c.created_at,
        c.updated_at,
        cat.name as category_name,
        cat.color as category_color
      FROM courses c
      LEFT JOIN categories cat ON c.category_id = cat.id
      WHERE c.id = $1 AND c.is_active = true`,
      [courseId]
    );

    const course = result.rows[0];
    if (!course) {
      throw createNotFoundError("Course not found");
    }

    // Check if user is enrolled (if authenticated)
    let isEnrolled = false;
    if (userId) {
      const enrollmentResult = await query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND payment_status = $3",
        [userId, courseId, "completed"]
      );
      isEnrolled = enrollmentResult.rows.length > 0;
    }

    // Get course statistics
    const statsResult = await query(
      `SELECT 
        COUNT(e.id) as total_enrollments,
        AVG(r.rating) as avg_rating,
        COUNT(r.id) as total_reviews
      FROM courses c
      LEFT JOIN enrollments e ON c.id = e.course_id AND e.payment_status = 'completed'
      LEFT JOIN reviews r ON c.id = r.course_id
      WHERE c.id = $1`,
      [courseId]
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        id: course.id,
        title: course.title,
        description: course.description,
        imageUrl: course.image_url,
        instructor: course.instructor,
        price: parseFloat(course.price),
        rating: parseFloat(course.rating),
        totalLessons: course.total_lessons,
        duration: course.duration_minutes,
        level: course.level,
        tags: course.tags || [],
        category: course.category_name,
        categoryColor: course.category_color,
        isFeatured: course.is_featured,
        isPopular: course.is_popular,
        createdAt: course.created_at,
        updatedAt: course.updated_at,
        isEnrolled,
        stats: {
          totalEnrollments: parseInt(stats.total_enrollments) || 0,
          averageRating: parseFloat(stats.avg_rating) || 0,
          totalReviews: parseInt(stats.total_reviews) || 0,
        },
      },
    });
  })
);

module.exports = router;
