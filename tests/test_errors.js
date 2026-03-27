const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
    AppError,
    ValidationError,
    NotFoundError,
    AuthorizationError,
    RateLimitError,
    ExternalServiceError,
    TimeoutError,
    safeJsonParse,
} = require('../utils/errors');

describe('Errors Utility', () => {
    it('AppError serializes to JSON correctly', () => {
        const err = new AppError('Test error', 500, 'TEST_CODE');
        const json = err.toJSON();
        assert.strictEqual(json.error, 'Test error');
        assert.strictEqual(json.code, 'TEST_CODE');
        assert.strictEqual(json.statusCode, 500);
    });

    it('ValidationError includes field in JSON', () => {
        const err = new ValidationError('Invalid email', 'email');
        assert.strictEqual(err.statusCode, 400);
        const json = err.toJSON();
        assert.strictEqual(json.field, 'email');
    });

    it('NotFoundError has correct defaults', () => {
        const err = new NotFoundError('User');
        assert.strictEqual(err.message, 'User not found');
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, 'NOT_FOUND');
    });

    it('AuthorizationError has correct defaults', () => {
        const err = new AuthorizationError();
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, 'UNAUTHORIZED');
    });

    it('RateLimitError includes retryAfter', () => {
        const err = new RateLimitError(120);
        assert.strictEqual(err.statusCode, 429);
        assert.strictEqual(err.retryAfter, 120);
    });

    it('ExternalServiceError includes service name', () => {
        const err = new ExternalServiceError('Stripe');
        assert.strictEqual(err.statusCode, 502);
        assert.strictEqual(err.service, 'Stripe');
    });

    it('TimeoutError includes operation and time', () => {
        const err = new TimeoutError('DB Query', 5000);
        assert.strictEqual(err.statusCode, 408);
        assert.strictEqual(err.operation, 'DB Query');
        assert.strictEqual(err.timeoutMs, 5000);
    });

    it('safeJsonParse parses valid JSON', () => {
        const result = safeJsonParse('{"test": true}');
        assert.deepStrictEqual(result, { test: true });
    });

    it('safeJsonParse returns default value on invalid JSON', () => {
        const result = safeJsonParse('invalid json', { fallback: true });
        assert.deepStrictEqual(result, { fallback: true });
    });
});
