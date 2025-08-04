const crypto = require("crypto");
const logger = require("../utils/logger");

const requestLogger = (req, res, next) => {
  // Generate unique request ID
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  // Add request ID to response headers
  res.setHeader("X-Request-ID", requestId);

  // Record start time
  const startTime = Date.now();

  // Log request start
  logger.info("Request started", {
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get("User-Agent"),
    contentType: req.get("Content-Type"),
    contentLength: req.get("Content-Length"),
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Log response
    logger.logRequest(req, res, responseTime);

    // Log additional details for errors
    if (res.statusCode >= 400) {
      logger.error("Error response", {
        requestId,
        statusCode: res.statusCode,
        method: req.method,
        url: req.originalUrl,
        responseTime: `${responseTime}ms`,
        userId: req.user?.id,
      });
    }

    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Additional middleware for request body logging (use with caution in production)
const logRequestBody = (req, res, next) => {
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    // Don't log sensitive data
    const sensitiveFields = ["password", "token", "secret", "key"];
    const sanitizedBody = { ...req.body };

    // Remove sensitive fields
    Object.keys(sanitizedBody).forEach((key) => {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        sanitizedBody[key] = "[REDACTED]";
      }
    });

    logger.debug("Request body", {
      requestId: req.requestId,
      body: sanitizedBody,
    });
  }

  next();
};

module.exports = {
  requestLogger,
  logRequestBody,
};
