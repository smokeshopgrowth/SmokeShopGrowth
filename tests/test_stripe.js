process.env.NODE_ENV = 'test';
process.env.STRIPE_API_KEY = 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_456';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server;
let baseUrl;

describe('Stripe & Billing Webhooks', () => {
    before(() => new Promise((resolve) => {
        const app = require('../server');
        server = app.listen(0, () => {
            baseUrl = `http://localhost:${server.address().port}`;
            resolve();
        });
    }));

    after(() => new Promise(resolve => server ? server.close(resolve) : resolve()));

    it('POST /webhook/stripe fails gracefully with invalid signature (HTTP 400)', () => {
        return new Promise((resolve, reject) => {
            const req = http.request(baseUrl + '/webhook/stripe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'stripe-signature': 't=123,v1=invalid_sig'
                }
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    assert.strictEqual(res.statusCode, 400);
                    assert.ok(data.includes('Webhook Error'));
                    resolve();
                });
            });
            req.on('error', reject);
            req.write(JSON.stringify({ type: 'checkout.session.completed' }));
            req.end();
        });
    });
});
