'use strict';

// In-memory job store
const jobs = new Map(); // jobId -> { status, logs, city, type, files, clients }

function makeJobId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pushLog(jobId, message, type = 'log') {
    const entry = { type, message, ts: Date.now() };
    const job = jobs.get(jobId);
    if (!job) return;
    job.logs.push(entry);
    broadcast(jobId, entry);
}

function broadcast(jobId, payload) {
    const job = jobs.get(jobId);
    if (!job) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    job.clients.forEach(res => { try { res.write(data); } catch { } });
    if (payload.type === 'done') {
        job.clients.forEach(res => { try { res.end(); } catch { } });
        job.clients = [];
    }
}

module.exports = { jobs, makeJobId, pushLog, broadcast };
