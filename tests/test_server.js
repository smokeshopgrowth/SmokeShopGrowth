process.env.NODE_ENV = 'test';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// Tests require API_KEY env var to be set (e.g. API_KEY=test-key node --test tests/*.js)
const API_KEY = process.env.API_KEY || 'test-key';

let server;
let baseUrl;

function get(path, { auth = false } = {}) {
    return new Promise((resolve, reject) => {
        const headers = auth ? { 'x-api-key': API_KEY } : {};
        http.get(baseUrl + path, { headers }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

function post(path, data, { auth = false } = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        };
        if (auth) headers['x-api-key'] = API_KEY;
        const req = http.request(baseUrl + path, {
            method: 'POST',
            headers,
        }, (res) => {
            let resBody = '';
            res.on('data', c => resBody += c);
            res.on('end', () => resolve({ status: res.statusCode, body: resBody }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

describe('Server Routes', () => {
    before(() => new Promise((resolve) => {
        // Ensure API_KEY is set for the server under test
        process.env.API_KEY = API_KEY;
        const app = require('../server');
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://localhost:${port}`;
            resolve();
        });
    }));

    after(() => new Promise((resolve) => {
        if (server) server.close(resolve);
        else resolve();
    }));

    it('GET /api/ping returns 200 with status ok', async () => {
        const res = await get('/api/ping');
        assert.strictEqual(res.status, 200);
        const data = JSON.parse(res.body);
        assert.strictEqual(data.status, 'ok');
        assert.ok(data.timestamp);
    });

    it('GET /api/jobs returns 200 with array', async () => {
        const res = await get('/api/jobs');
        assert.strictEqual(res.status, 200);
        const data = JSON.parse(res.body);
        assert.ok(Array.isArray(data));
    });

    // POST /api/run does not require auth currently

    it('POST /api/run without city returns 400', async () => {
        const res = await post('/api/run', {}, { auth: true });
        assert.strictEqual(res.status, 400);
        const data = JSON.parse(res.body);
        assert.ok(data.error.toLowerCase().includes('city'));
    });

});

describe('Pipeline', () => {
    it('should have run_pipeline.mjs loadable', () => {
        assert.ok(
            require('fs').existsSync('scripts/run_pipeline.mjs'),
            'scripts/run_pipeline.mjs should exist'
        );
    });
});
