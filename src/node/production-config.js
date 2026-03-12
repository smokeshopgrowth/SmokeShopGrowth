/**
 * Production Configuration
 * ========================
 * Environment-specific settings for production deployment
 */

'use strict';

module.exports = {
  // Environment
  env: process.env.NODE_ENV || 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  
  // Database
  database: {
    type: process.env.DATABASE_TYPE || 'sqlite',
    url: process.env.DATABASE_URL || 'sqlite:./data/submissions.db',
    // SQLite specific
    filepath: process.env.DATABASE_FILE || './data/submissions.db',
    // PostgreSQL specific
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smokeshopgrowth',
    // Connection pool
    pool: {
      min: parseInt(process.env.DB_POOL_MIN || '2', 10),
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    }
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || '50', 10),
    message: 'Too many requests, please try again later',
  },

  // Analytics
  analytics: {
    googleId: process.env.ANALYTICS_ID || null,
    trackingEnabled: !!process.env.ANALYTICS_ID,
  },

  // Email (for notifications)
  email: {
    enabled: !!process.env.SMTP_HOST,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'noreply@smokeshopgrowth.com',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
    format: process.env.LOG_FORMAT || 'json',
  },

  // Security
  security: {
    corsEnabled: process.env.CORS_ENABLED === 'true',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    helmetEnabled: true,
    hpp: true, // HTTP Parameter Pollution protection
  },

  // Feature flags
  features: {
    adminDashboard: process.env.ENABLE_ADMIN_DASHBOARD === 'true',
    googleSheetsExport: !!process.env.GOOGLE_SHEETS_KEY,
    emailNotifications: !!process.env.SMTP_HOST,
  },

  // Timeouts
  timeouts: {
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000', 10), // 30s
    dbTimeout: parseInt(process.env.DB_TIMEOUT || '10000', 10), // 10s
  },

  // API
  api: {
    version: '1.0.0',
    prefix: '/api',
  },
};
