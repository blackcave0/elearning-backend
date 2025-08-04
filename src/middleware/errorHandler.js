const logger = require('../utils/logger');

// Custom error class for API errors
class APIError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Global error handler middleware
const errorHandler = (error, req, res, next) => {
  let { statusCode = 500, message } = error;
  let isOperational = error.isOperational || false;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    isOperational = true;
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized access';
    isOperational = true;
  } else if (error.code === '23505') { // PostgreSQL unique violation
    statusCode = 409;
    message = 'Resource already exists';
    isOperational = true;
  } else if (error.code === '23503') { // PostgreSQL foreign key violation
    statusCode = 400;
    message = 'Invalid reference to related resource';
    isOperational = true;
  } else if (error.code === '23502') { // PostgreSQL not null violation
    statusCode = 400;
    message = 'Required field is missing';
    isOperational = true;
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    isOperational = true;
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    isOperational = true;
  } else if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
    statusCode = 400;
    message = 'Invalid JSON format';
    isOperational = true;
  }

  // Log error
  const errorContext = {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    body: req.body,
    params: req.params,
    query: req.query,
  };

  if (statusCode >= 500) {
    logger.error('Server Error', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      context: errorContext,
    });
  } else {
    logger.warn('Client Error', {
      error: {
        name: error.name,
        message: error.message,
      },
      context: errorContext,
    });
  }

  // Send error response
  const errorResponse = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };

  // Add additional details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error = {
      name: error.name,
      stack: error.stack,
      details: error.details || null,
    };
  }

  // Add request ID if available
  if (req.requestId) {
    errorResponse.requestId = req.requestId;
  }

  res.status(statusCode).json(errorResponse);
};

// 404 handler
const notFoundHandler = (req, res, next) => {
  const error = new APIError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

// Async wrapper to catch async errors
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Custom error creators
const createValidationError = (message, details = null) => {
  const error = new APIError(message, 400);
  error.name = 'ValidationError';
  error.details = details;
  return error;
};

const createAuthError = (message = 'Authentication required') => {
  const error = new APIError(message, 401);
  error.name = 'UnauthorizedError';
  return error;
};

const createForbiddenError = (message = 'Access forbidden') => {
  const error = new APIError(message, 403);
  error.name = 'ForbiddenError';
  return error;
};

const createNotFoundError = (message = 'Resource not found') => {
  const error = new APIError(message, 404);
  error.name = 'NotFoundError';
  return error;
};

const createConflictError = (message = 'Resource conflict') => {
  const error = new APIError(message, 409);
  error.name = 'ConflictError';
  return error;
};

const createRateLimitError = (message = 'Too many requests') => {
  const error = new APIError(message, 429);
  error.name = 'RateLimitError';
  return error;
};

const createServerError = (message = 'Internal server error') => {
  const error = new APIError(message, 500, false);
  error.name = 'ServerError';
  return error;
};

// Validation error formatter for express-validator
const formatValidationErrors = (errors) => {
  return errors.map(error => ({
    field: error.path || error.param,
    message: error.msg,
    value: error.value,
  }));
};

module.exports = {
  APIError,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  createValidationError,
  createAuthError,
  createForbiddenError,
  createNotFoundError,
  createConflictError,
  createRateLimitError,
  createServerError,
  formatValidationErrors,
};
