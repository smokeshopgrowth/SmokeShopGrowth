'use strict';

/**
 * Custom Error Classes and Error Handling Utilities
 */

class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: this.message,
            code: this.code,
            statusCode: this.statusCode,
        };
    }
}

class ValidationError extends AppError {
    constructor(message, field = null) {
        super(message, 400, 'VALIDATION_ERROR');
        this.field = field;
    }

    toJSON() {
        return {
            ...super.toJSON(),
            field: this.field,
        };
    }
}

class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
        this.resource = resource;
    }
}

class AuthorizationError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

class RateLimitError extends AppError {
    constructor(retryAfter = 60) {
        super('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
        this.retryAfter = retryAfter;
    }
}

class ExternalServiceError extends AppError {
    constructor(service, originalError = null) {
        super(`External service error: ${service}`, 502, 'EXTERNAL_SERVICE_ERROR');
        this.service = service;
        this.originalError = originalError;
    }
}

class TimeoutError extends AppError {
    constructor(operation, timeoutMs) {
        super(`Operation timed out: ${operation} (${timeoutMs}ms)`, 408, 'TIMEOUT');
        this.operation = operation;
        this.timeoutMs = timeoutMs;
    }
}

/**
 * Retry utility with exponential backoff
 */
async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelayMs = 1000,
        maxDelayMs = 30000,
        factor = 2,
        retryCondition = () => true,
        onRetry = () => {},
    } = options;

    let lastError;
    let delay = initialDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;

            if (attempt === maxRetries || !retryCondition(error, attempt)) {
                throw error;
            }

            onRetry(error, attempt + 1, delay);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * factor, maxDelayMs);
        }
    }

    throw lastError;
}

/**
 * Timeout wrapper for async operations
 */
async function withTimeout(promise, timeoutMs, operation = 'Operation') {
    let timeoutId;
    
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new TimeoutError(operation, timeoutMs));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Safe JSON parse with default
 */
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch {
        return defaultValue;
    }
}

/**
 * Express error handler middleware
 */
function errorHandler(err, req, res, next) {
    const { createLogger } = require('./logger');
    const logger = createLogger('ErrorHandler');

    // Log the error
    if (err.isOperational) {
        logger.warn(`Operational error: ${err.message}`, {
            code: err.code,
            path: req.path,
            method: req.method,
        });
    } else {
        logger.error('Unexpected error', {
            message: err.message,
            stack: err.stack,
            path: req.path,
            method: req.method,
        });
    }

    // Handle specific error types
    if (err instanceof AppError) {
        return res.status(err.statusCode).json(err.toJSON());
    }

    // Handle validation errors from external libraries (like Joi)
    if (err.name === 'ValidationError' || err.isJoi) {
        return res.status(400).json({
            error: err.message,
            code: 'VALIDATION_ERROR',
            details: err.details || undefined,
        });
    }

    // Handle JSON parse errors
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            error: 'Invalid JSON in request body',
            code: 'INVALID_JSON',
        });
    }

    // Default error response
    const statusCode = err.statusCode || err.status || 500;
    const message = process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'Internal server error'
        : err.message;

    res.status(statusCode).json({
        error: message,
        code: 'INTERNAL_ERROR',
    });
}

/**
 * Async route wrapper to catch errors
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    AppError,
    ValidationError,
    NotFoundError,
    AuthorizationError,
    RateLimitError,
    ExternalServiceError,
    TimeoutError,
    withRetry,
    withTimeout,
    safeJsonParse,
    errorHandler,
    asyncHandler,
};
