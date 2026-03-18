const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server;
let baseUrl;

function get(path) {
    return new Promise((resolve, reject) => {
        http.get(baseUrl + path, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
}

function post(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request(baseUrl + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
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

    it('POST /api/run without city returns 400', async () => {
        const res = await post('/api/run', {});
        assert.strictEqual(res.status, 400);
        const data = JSON.parse(res.body);
        assert.ok(data.error.includes('City'));
    });

    it('GET /demo returns HTML', async () => {
        const res = await get('/demo?name=TestShop&city=Houston');
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.includes('<!DOCTYPE html>') || res.body.includes('TestShop'));
    });

    it('POST /api/lead without email returns 400', async () => {
        const res = await post('/api/lead', { name: 'Test' });
        assert.strictEqual(res.status, 400);
        const data = JSON.parse(res.body);
        assert.ok(data.error.includes('email'));
    });

    it('GET /api/leads returns leads array', async () => {
        const res = await get('/api/leads');
        assert.strictEqual(res.status, 200);
        const data = JSON.parse(res.body);
        assert.ok(data.leads !== undefined);
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
