
import https from 'https';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = '7b943221-920f-43ec-8910-a8a49403cfea';

const updatePayload = fs.readFileSync(path.join(__dirname, '..', '..', 'assistant_update.json'), 'utf-8');

const options = {
    hostname: 'api.vapi.ai',
    path: `/assistant/${VAPI_ASSISTANT_ID}`,
    method: 'PATCH',
    headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(updatePayload),
    },
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Response from VAPI:');
        console.log(JSON.parse(data));
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(updatePayload);
req.end();
