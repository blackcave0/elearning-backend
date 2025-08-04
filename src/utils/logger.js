const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Create logs directory if it doesn't exist
const logDir = process.env.LOG_DIR || './logs';
require('fs').mkdirSync(logDir, { recursive: true });

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Define console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return msg;
  })
);

// Create transport configurations
const transports = [
  // Console transport for development
  new winston.transports.Console({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
    handleExceptions: true,
    handleRejections: true,
  }),

  // File transport for all logs
  new DailyRotateFile({
    filename: path.join(logDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat,
    level: 'info',
  }),

  // Separate file for errors
  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    format: logFormat,
    level: 'error',
  }),
];

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: {
    service: 'quipgen-elearning-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  transports,
  exitOnError: false,
});

// Add request ID to logs if available
logger.addRequestId = (requestId) => {
  return logger.child({ requestId });
};

// Helper methods for structured logging
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
  };

  if (req.user) {
    logData.userId = req.user.id;
    logData.userEmail = req.user.email;
  }

  const level = res.statusCode >= 400 ? 'error' : 'info';
  logger[level]('HTTP Request', logData);
};

logger.logPayment = (action, data) => {
  logger.info(`Payment ${action}`, {
    category: 'payment',
    action,
    ...data,
  });
};

logger.logEnrollment = (action, data) => {
  logger.info(`Enrollment ${action}`, {
    category: 'enrollment',
    action,
    ...data,
  });
};

logger.logAuth = (action, data) => {
  logger.info(`Auth ${action}`, {
    category: 'auth',
    action,
    ...data,
  });
};

logger.logDatabase = (query, duration, rowCount) => {
  logger.debug('Database Query', {
    category: 'database',
    query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
    duration,
    rowCount,
  });
};

logger.logSecurity = (event, data) => {
  logger.warn(`Security Event: ${event}`, {
    category: 'security',
    event,
    ...data,
  });
};

// Performance monitoring helpers
logger.startTimer = (label) => {
  const start = Date.now();
  return {
    end: () => {
      const duration = Date.now() - start;
      logger.debug(`Timer: ${label}`, { duration: `${duration}ms` });
      return duration;
    },
  };
};

// Error logging with context
logger.logError = (error, context = {}) => {
  logger.error(error.message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    context,
  });
};

// Validation error logging
logger.logValidationError = (errors, context = {}) => {
  logger.warn('Validation failed', {
    category: 'validation',
    errors,
    context,
  });
};

// Business logic logging
logger.logBusinessEvent = (event, data) => {
  logger.info(`Business Event: ${event}`, {
    category: 'business',
    event,
    ...data,
  });
};

module.exports = logger;
