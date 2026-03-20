/**
 * Vercel Serverless Function Entry Point
 * =======================================
 * Wraps the Express app for Vercel serverless deployment.
 */
const app = require('../server');

module.exports = app;
