const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');
const { asyncHandler, createValidationError, createNotFoundError, createConflictError } = require('../middleware/errorHandler');
const { createOrder, verifyPaymentSignature, fetchPayment } = require('../config/razorpay');
const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// Create Razorpay order for course purchase
router.post(
  '/create-order',
  authenticateUser,
  [
    body('courseId').isInt({ min: 1 }).withMessage('Valid course ID is required'),
    body('currency').optional().isIn(['INR', 'USD']).withMessage('Currency must be INR or USD'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createValidationError('Validation failed', errors.array());
    }

    const { courseId, currency = 'INR' } = req.body;
    const userId = req.user.id;

    // Check if course exists and is active
    const courseResult = await query(
      'SELECT id, title, price, is_active FROM courses WHERE id = $1',
      [courseId]
    );

    const course = courseResult.rows[0];
    if (!course) {
      throw createNotFoundError('Course not found');
    }

    if (!course.is_active) {
      throw createValidationError('Course is not available for purchase');
    }

    // Check if user is already enrolled
    const enrollmentResult = await query(
      'SELECT id, payment_status FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );

    const existingEnrollment = enrollmentResult.rows[0];
    if (existingEnrollment && existingEnrollment.payment_status === 'completed') {
      throw createConflictError('Already enrolled in this course');
    }

    // Create Razorpay order
    const amount = Math.round(course.price * 100); // Convert to paise
    const orderData = {
      amount,
      currency,
      receipt: `course_${courseId}_user_${userId}_${Date.now()}`,
      notes: {
        courseId: courseId.toString(),
        userId: userId.toString(),
        courseTitle: course.title,
      },
    };

    const razorpayOrder = await createOrder(orderData);

    // Create or update enrollment record
    const enrollmentData = {
      user_id: userId,
      course_id: courseId,
      razorpay_order_id: razorpayOrder.id,
      amount_paid: course.price,
      payment_status: 'pending',
    };

    if (existingEnrollment) {
      // Update existing enrollment
      await query(
        `UPDATE enrollments 
         SET razorpay_order_id = $1, amount_paid = $2, payment_status = 'pending'
         WHERE id = $3`,
        [razorpayOrder.id, course.price, existingEnrollment.id]
      );
    } else {
      // Create new enrollment
      await query(
        `INSERT INTO enrollments (user_id, course_id, razorpay_order_id, amount_paid, payment_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, courseId, razorpayOrder.id, course.price, 'pending']
      );
    }

    logger.logPayment('order_created', {
      userId,
      courseId,
      orderId: razorpayOrder.id,
      amount: course.price,
      currency,
    });

    res.json({
      success: true,
      message: 'Order created successfully',
      data: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID,
        courseTitle: course.title,
        coursePrice: course.price,
      },
    });
  })
);

// Verify payment and complete enrollment
router.post(
  '/verify',
  authenticateUser,
  [
    body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
    body('razorpay_payment_id').notEmpty().withMessage('Payment ID is required'),
    body('razorpay_signature').notEmpty().withMessage('Signature is required'),
    body('course_id').isInt({ min: 1 }).withMessage('Valid course ID is required'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw createValidationError('Validation failed', errors.array());
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      course_id,
    } = req.body;
    const userId = req.user.id;

    // Find enrollment record
    const enrollmentResult = await query(
      'SELECT id, payment_status FROM enrollments WHERE user_id = $1 AND course_id = $2 AND razorpay_order_id = $3',
      [userId, course_id, razorpay_order_id]
    );

    const enrollment = enrollmentResult.rows[0];
    if (!enrollment) {
      throw createNotFoundError('Enrollment record not found');
    }

    if (enrollment.payment_status === 'completed') {
      return res.json({
        success: true,
        message: 'Payment already verified',
        data: { enrollmentId: enrollment.id },
      });
    }

    // Verify payment signature
    const isSignatureValid = verifyPaymentSignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });

    if (!isSignatureValid) {
      // Update enrollment status to failed
      await query(
        'UPDATE enrollments SET payment_status = $1 WHERE id = $2',
        ['failed', enrollment.id]
      );

      logger.logPayment('verification_failed', {
        userId,
        courseId: course_id,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        reason: 'Invalid signature',
      });

      throw createValidationError('Payment verification failed');
    }

    // Fetch payment details from Razorpay
    const paymentDetails = await fetchPayment(razorpay_payment_id);

    // Update enrollment in transaction
    const result = await transaction(async (client) => {
      // Update enrollment status
      const updateResult = await client.query(
        `UPDATE enrollments 
         SET payment_status = $1, razorpay_payment_id = $2, payment_completed_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        ['completed', razorpay_payment_id, enrollment.id]
      );

      // Initialize user progress for all lessons
      const lessonsResult = await client.query(
        'SELECT id FROM lessons WHERE course_id = $1 ORDER BY order_index',
        [course_id]
      );

      for (const lesson of lessonsResult.rows) {
        await client.query(
          `INSERT INTO user_progress (user_id, course_id, lesson_id, is_completed, progress_percentage)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, course_id, lesson_id) DO NOTHING`,
          [userId, course_id, lesson.id, false, 0.0]
        );
      }

      return updateResult.rows[0];
    });

    logger.logPayment('payment_verified', {
      userId,
      courseId: course_id,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      amount: paymentDetails.amount / 100,
      status: paymentDetails.status,
    });

    logger.logEnrollment('completed', {
      userId,
      courseId: course_id,
      enrollmentId: result.id,
    });

    res.json({
      success: true,
      message: 'Payment verified and enrollment completed successfully',
      data: {
        enrollmentId: result.id,
        paymentStatus: result.payment_status,
        enrolledAt: result.payment_completed_at,
      },
    });
  })
);

// Get payment status
router.get(
  '/status/:orderId',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;

    // Find enrollment record
    const result = await query(
      `SELECT e.*, c.title as course_title, c.price as course_price
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = $1 AND e.razorpay_order_id = $2`,
      [userId, orderId]
    );

    const enrollment = result.rows[0];
    if (!enrollment) {
      throw createNotFoundError('Payment record not found');
    }

    res.json({
      success: true,
      data: {
        orderId: enrollment.razorpay_order_id,
        paymentId: enrollment.razorpay_payment_id,
        paymentStatus: enrollment.payment_status,
        amount: enrollment.amount_paid,
        courseTitle: enrollment.course_title,
        coursePrice: enrollment.course_price,
        enrolledAt: enrollment.enrolled_at,
        paymentCompletedAt: enrollment.payment_completed_at,
      },
    });
  })
);

// Get user's payment history
router.get(
  '/history',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT e.*, c.title as course_title, c.image_url as course_image
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = $1
       ORDER BY e.enrolled_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) FROM enrollments WHERE user_id = $1',
      [userId]
    );

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        payments: result.rows,
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

// Webhook endpoint for Razorpay events
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    // Verify webhook signature
    try {
      const { verifyWebhookSignature } = require('../config/razorpay');
      const isValid = verifyWebhookSignature(body, signature);
      
      if (!isValid) {
        logger.logSecurity('webhook_signature_invalid', {
          signature,
          ip: req.ip,
        });
        return res.status(400).json({ success: false, message: 'Invalid signature' });
      }
    } catch (error) {
      logger.error('Webhook signature verification failed:', error);
      return res.status(400).json({ success: false, message: 'Signature verification failed' });
    }

    const event = JSON.parse(body);
    
    logger.info('Webhook received', {
      event: event.event,
      paymentId: event.payload?.payment?.entity?.id,
      orderId: event.payload?.payment?.entity?.order_id,
    });

    // Handle different webhook events
    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity);
        break;
      case 'order.paid':
        await handleOrderPaid(event.payload.order.entity);
        break;
      default:
        logger.info('Unhandled webhook event:', event.event);
    }

    res.json({ success: true });
  })
);

// Webhook event handlers
async function handlePaymentCaptured(payment) {
  try {
    const orderId = payment.order_id;
    const paymentId = payment.id;

    await query(
      `UPDATE enrollments 
       SET payment_status = 'completed', razorpay_payment_id = $1, payment_completed_at = CURRENT_TIMESTAMP
       WHERE razorpay_order_id = $2 AND payment_status = 'pending'`,
      [paymentId, orderId]
    );

    logger.logPayment('webhook_payment_captured', {
      orderId,
      paymentId,
      amount: payment.amount / 100,
    });
  } catch (error) {
    logger.error('Error handling payment captured webhook:', error);
  }
}

async function handlePaymentFailed(payment) {
  try {
    const orderId = payment.order_id;
    const paymentId = payment.id;

    await query(
      `UPDATE enrollments 
       SET payment_status = 'failed', razorpay_payment_id = $1
       WHERE razorpay_order_id = $2`,
      [paymentId, orderId]
    );

    logger.logPayment('webhook_payment_failed', {
      orderId,
      paymentId,
      errorDescription: payment.error_description,
    });
  } catch (error) {
    logger.error('Error handling payment failed webhook:', error);
  }
}

async function handleOrderPaid(order) {
  try {
    const orderId = order.id;

    logger.logPayment('webhook_order_paid', {
      orderId,
      amount: order.amount / 100,
      status: order.status,
    });
  } catch (error) {
    logger.error('Error handling order paid webhook:', error);
  }
}

module.exports = router;
