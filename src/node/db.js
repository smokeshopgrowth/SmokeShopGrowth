'use strict';

// Re-export the database module from the db/ directory.
// This shim allows both require('./db') and require('../src/node/db')
// to resolve explicitly without relying on Node.js directory index resolution.
module.exports = require('./db/index.js');
