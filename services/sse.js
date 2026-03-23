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
    const deadClients = [];
    job.clients.forEach((res, idx) => {
        try {
            res.write(data);
        } catch (err) {
            console.warn(`[SSE] Client ${idx} write failed:`, err.message);
            deadClients.push(idx);
        }
    });
    // Remove dead clients in reverse order to preserve indices
    deadClients.reverse().forEach(idx => job.clients.splice(idx, 1));
    
    if (payload.type === 'done') {
        job.clients.forEach(res => { try { res.end(); } catch { /* ignore close errors */ } });
        job.clients = [];
    }
}

module.exports = { jobs, makeJobId, pushLog, broadcast };
