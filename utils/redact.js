'use strict';

/**
 * PII Redaction Utility
 * Masks sensitive data (emails, phone numbers) for safe logging.
 */

/**
 * Masks an email address: "john@example.com" → "jo***@example.com"
 */
function redactEmail(email) {
    if (!email || typeof email !== 'string') return email;
    const at = email.indexOf('@');
    if (at < 1) return '***';
    const local = email.slice(0, at);
    const domain = email.slice(at);
    const visible = Math.min(2, local.length);
    return local.slice(0, visible) + '***' + domain;
}

/**
 * Masks a phone number: "+13125551234" → "+1312***1234"
 */
function redactPhone(phone) {
    if (!phone || typeof phone !== 'string') return phone;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return '***';
    return phone.slice(0, 4) + '***' + phone.slice(-4);
}

/**
 * Redacts known PII fields in an object (shallow).
 * Returns a new object with redacted values.
 */
function redactPII(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = { ...obj };
    if (result.email) result.email = redactEmail(result.email);
    if (result.phone) result.phone = redactPhone(result.phone);
    if (result.collected_email) result.collected_email = redactEmail(result.collected_email);
    return result;
}

module.exports = { redactEmail, redactPhone, redactPII };
