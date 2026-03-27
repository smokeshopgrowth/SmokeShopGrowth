process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-key';
process.env.ELEVENLABS_API_KEY = 'test_xi_key';
process.env.ELEVENLABS_AGENT_ID = 'test_agent';
process.env.ELEVENLABS_PHONE_NUMBER_ID = 'test_phone';
process.env.VAPI_WEBHOOK_SECRET = 'test_vapi_secret';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server;
let baseUrl;

function post(path, data, { auth = false, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const body = typeof data === 'string' ? data : JSON.stringify(data);
        const reqHeaders = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...headers
        };
        if (auth) reqHeaders['x-api-key'] = process.env.API_KEY;

        const req = http.request(baseUrl + path, { method: 'POST', headers: reqHeaders }, (res) => {
            let resBody = '';
            res.on('data', c => resBody += c);
            res.on('end', () => resolve({ status: res.statusCode, body: resBody }));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

describe('Voice Agent Webhooks', () => {
    before(() => new Promise((resolve) => {
        // Mock global fetch
        global.fetch = async (url) => {
            if (url.includes('elevenlabs.io')) {
                return { ok: true, json: async () => ({ conversation_id: 'conv_123' }) };
            }
            return { ok: true, json: async () => ({}) };
        };
        
        const app = require('../server');
        server = app.listen(0, () => {
            baseUrl = `http://localhost:${server.address().port}`;
            resolve();
        });
    }));

    after(() => new Promise(resolve => server ? server.close(resolve) : resolve()));

    it('POST /webhook/call returns 401 if missing auth', async () => {
        const res = await post('/webhook/call', { phone: '123' });
        assert.strictEqual(res.status, 401);
    });

    it('POST /webhook/call returns 400 if phone is missing', async () => {
        const res = await post('/webhook/call', { business_name: 'Smoke' }, { auth: true });
        assert.strictEqual(res.status, 400);
    });

    it('POST /webhook/call triggers ElevenLabs fetch', async () => {
        const res = await post('/webhook/call', { phone: '123', business_name: 'Smoke' }, { auth: true });
        assert.strictEqual(res.status, 200);
        const data = JSON.parse(res.body);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.conversation_id, 'conv_123');
    });

    it('POST /webhook/vapi returns 401 if missing secret', async () => {
        const res = await post('/webhook/vapi', { message: { type: 'end-of-call-report' } });
        assert.strictEqual(res.status, 401);
    });

    it('POST /webhook/vapi returns 200 with valid secret', async () => {
        const res = await post('/webhook/vapi', { message: { type: 'end-of-call-report' } }, {
            headers: { 'x-vapi-secret': 'test_vapi_secret' }
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.body), { received: true });
    });
});
