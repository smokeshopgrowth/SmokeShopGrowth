'use strict';

/**
 * Input Validation Utilities
 * Lightweight validation without external dependencies
 */

const { ValidationError } = require('./errors');

/**
 * Validation rules
 */
const rules = {
    required: (value, field) => {
        if (value === undefined || value === null || value === '') {
            throw new ValidationError(`${field} is required`, field);
        }
        return value;
    },

    string: (value, field) => {
        if (typeof value !== 'string') {
            throw new ValidationError(`${field} must be a string`, field);
        }
        return value;
    },

    number: (value, field) => {
        const num = Number(value);
        if (isNaN(num)) {
            throw new ValidationError(`${field} must be a number`, field);
        }
        return num;
    },

    integer: (value, field) => {
        const num = parseInt(value, 10);
        if (isNaN(num) || !Number.isInteger(num)) {
            throw new ValidationError(`${field} must be an integer`, field);
        }
        return num;
    },

    boolean: (value, field) => {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === '1') return true;
        if (value === 'false' || value === '0') return false;
        throw new ValidationError(`${field} must be a boolean`, field);
    },

    email: (value, field) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            throw new ValidationError(`${field} must be a valid email address`, field);
        }
        return value;
    },

    phone: (value, field) => {
        const phoneRegex = /^[\d\s()+-]{10,}$/;
        if (!phoneRegex.test(value)) {
            throw new ValidationError(`${field} must be a valid phone number`, field);
        }
        return value.replace(/[^\d+]/g, '');
    },

    url: (value, field) => {
        try {
            new URL(value);
            return value;
        } catch {
            throw new ValidationError(`${field} must be a valid URL`, field);
        }
    },

    minLength: (min) => (value, field) => {
        if (typeof value === 'string' && value.length < min) {
            throw new ValidationError(`${field} must be at least ${min} characters`, field);
        }
        return value;
    },

    maxLength: (max) => (value, field) => {
        if (typeof value === 'string' && value.length > max) {
            throw new ValidationError(`${field} must be at most ${max} characters`, field);
        }
        return value;
    },

    min: (min) => (value, field) => {
        if (Number(value) < min) {
            throw new ValidationError(`${field} must be at least ${min}`, field);
        }
        return value;
    },

    max: (max) => (value, field) => {
        if (Number(value) > max) {
            throw new ValidationError(`${field} must be at most ${max}`, field);
        }
        return value;
    },

    pattern: (regex, message) => (value, field) => {
        if (!regex.test(value)) {
            throw new ValidationError(message || `${field} has invalid format`, field);
        }
        return value;
    },

    oneOf: (allowedValues) => (value, field) => {
        if (!allowedValues.includes(value)) {
            throw new ValidationError(
                `${field} must be one of: ${allowedValues.join(', ')}`,
                field
            );
        }
        return value;
    },

    sanitizeString: (value) => {
        if (typeof value !== 'string') return value;
        return value.trim().replace(/<[^>]*>/g, '');
    },

    alphanumericWithSpaces: (value, field) => {
        if (!/^[a-zA-Z0-9\s\-]+$/.test(value)) {
            throw new ValidationError(
                `${field} can only contain letters, numbers, spaces, and hyphens`,
                field
            );
        }
        return value;
    },
};

/**
 * Schema-based validator
 */
function validate(data, schema) {
    const errors = [];
    const validated = {};

    for (const [field, fieldRules] of Object.entries(schema)) {
        let value = data[field];
        const isOptional = fieldRules.optional === true;

        try {
            // Handle optional fields
            if ((value === undefined || value === null || value === '') && isOptional) {
                if (fieldRules.default !== undefined) {
                    validated[field] = fieldRules.default;
                }
                continue;
            }

            // Apply each rule
            for (const rule of fieldRules.rules || []) {
                value = rule(value, field);
            }

            // Apply transform if provided
            if (fieldRules.transform) {
                value = fieldRules.transform(value);
            }

            validated[field] = value;
        } catch (err) {
            if (err instanceof ValidationError) {
                errors.push(err);
            } else {
                throw err;
            }
        }
    }

    if (errors.length > 0) {
        const error = new ValidationError(
            errors.map(e => e.message).join('; ')
        );
        error.details = errors.map(e => ({ field: e.field, message: e.message }));
        throw error;
    }

    return validated;
}

/**
 * Common schemas
 */
const schemas = {
    pipelineRun: {
        city: {
            rules: [
                rules.required,
                rules.string,
                rules.minLength(2),
                rules.maxLength(50),
                rules.alphanumericWithSpaces,
            ],
            transform: (v) => rules.sanitizeString(v),
        },
        bizType: {
            optional: true,
            default: 'smoke shop',
            rules: [rules.string, rules.maxLength(100)],
            transform: (v) => rules.sanitizeString(v),
        },
        maxResults: {
            optional: true,
            default: 100,
            rules: [rules.integer, rules.min(1), rules.max(500)],
        },
        skipLighthouse: {
            optional: true,
            default: true,
            rules: [rules.boolean],
        },
        generateDemo: {
            optional: true,
            default: true,
            rules: [rules.boolean],
        },
        exportSheets: {
            optional: true,
            default: false,
            rules: [rules.boolean],
        },
        sheetsId: {
            optional: true,
            default: '',
            rules: [rules.string, rules.pattern(/^[a-zA-Z0-9_-]*$/, 'Invalid Google Sheets ID format')],
        },
    },

    leadCapture: {
        email: {
            rules: [rules.required, rules.string, rules.email],
        },
        name: {
            optional: true,
            default: 'Unknown',
            rules: [rules.string, rules.maxLength(100)],
            transform: (v) => rules.sanitizeString(v),
        },
        phone: {
            optional: true,
            default: '',
            rules: [rules.string],
        },
        city: {
            optional: true,
            default: '',
            rules: [rules.string, rules.maxLength(100)],
        },
    },

    templateSubmission: {
        shopName: {
            rules: [rules.required, rules.string, rules.minLength(2), rules.maxLength(100)],
            transform: (v) => rules.sanitizeString(v),
        },
        city: {
            rules: [rules.required, rules.string, rules.maxLength(100)],
            transform: (v) => rules.sanitizeString(v),
        },
        phone: {
            rules: [rules.required, rules.phone],
        },
        email: {
            rules: [rules.required, rules.email],
        },
    },

    quickCall: {
        phone: {
            rules: [rules.required, rules.phone],
        },
        business_name: {
            optional: true,
            default: '',
            rules: [rules.string, rules.maxLength(100)],
        },
        city: {
            optional: true,
            default: '',
            rules: [rules.string, rules.maxLength(100)],
        },
    },
};

module.exports = {
    rules,
    validate,
    schemas,
    ValidationError,
};
