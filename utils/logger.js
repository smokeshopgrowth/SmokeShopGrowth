'use strict';

/**
 * Structured Logger Utility
 * Provides consistent logging with levels, timestamps, and optional context
 */

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

const LOG_COLORS = {
    DEBUG: '\x1b[36m',  // Cyan
    INFO: '\x1b[32m',   // Green
    WARN: '\x1b[33m',   // Yellow
    ERROR: '\x1b[31m',  // Red
    RESET: '\x1b[0m',
};

class Logger {
    constructor(context = 'App') {
        this.context = context;
        this.level = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;
        this.enableColors = process.stdout.isTTY !== false;
    }

    _formatTimestamp() {
        return new Date().toISOString();
    }

    _formatMessage(level, message, meta = {}) {
        const timestamp = this._formatTimestamp();
        const levelStr = level.padEnd(5);
        const contextStr = `[${this.context}]`;
        
        let metaStr = '';
        if (Object.keys(meta).length > 0) {
            metaStr = ' ' + JSON.stringify(meta);
        }

        if (this.enableColors) {
            const color = LOG_COLORS[level] || LOG_COLORS.RESET;
            return `${LOG_COLORS.RESET}${timestamp} ${color}${levelStr}${LOG_COLORS.RESET} ${contextStr} ${message}${metaStr}`;
        }

        return `${timestamp} ${levelStr} ${contextStr} ${message}${metaStr}`;
    }

    _log(level, message, meta) {
        if (LOG_LEVELS[level] < this.level) return;

        const formatted = this._formatMessage(level, message, meta);
        
        if (level === 'ERROR') {
            console.error(formatted);
        } else if (level === 'WARN') {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
    }

    debug(message, meta = {}) {
        this._log('DEBUG', message, meta);
    }

    info(message, meta = {}) {
        this._log('INFO', message, meta);
    }

    warn(message, meta = {}) {
        this._log('WARN', message, meta);
    }

    error(message, meta = {}) {
        if (meta instanceof Error) {
            meta = {
                errorMessage: meta.message,
                stack: meta.stack,
            };
        }
        this._log('ERROR', message, meta);
    }

    child(context) {
        return new Logger(`${this.context}:${context}`);
    }
}

// Create default logger instance
const defaultLogger = new Logger();

// Factory function to create context-specific loggers
function createLogger(context) {
    return new Logger(context);
}

module.exports = {
    Logger,
    createLogger,
    logger: defaultLogger,
    LOG_LEVELS,
};
