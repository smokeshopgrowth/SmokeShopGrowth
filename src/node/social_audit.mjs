#!/usr/bin/env node
/**
 * Social Audit
 * ============
 * Reads audited_leads.csv, looks at social handles, and gives them a score.
 * Example checks: 
 * - Has Instagram?
 * - Has Facebook?
 * Output goes to social_audited.csv.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { format } from '@fast-csv/format';

const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const INPUT_FILE = getArg('--input', 'data/audited_leads.csv');
const OUTPUT_FILE = getArg('--output', 'data/social_audited.csv');

function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Input file not found: ${filePath}`));
        }
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

function writeCsv(filePath, rows) {
    return new Promise((resolve, reject) => {
        if (rows.length === 0) return resolve();
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const ws = fs.createWriteStream(filePath);
        const headers = Object.keys(rows[0]);
        const stream = format({ headers });
        stream.pipe(ws);
        for (const row of rows) stream.write(row);
        stream.end();
        ws.on('finish', resolve);
        ws.on('error', reject);
    });
}

async function main() {
    console.log(`Starting social audit...`);
    const leads = await readCsv(INPUT_FILE);

    const audited = leads.map(lead => {
        const hasIg = !!lead.instagram;
        const hasFb = !!lead.facebook;
        let score = 0;
        let notes = [];

        if (hasIg) {
            score += 5;
            notes.push('Has Instagram');
        } else {
            notes.push('Missing Instagram');
        }

        if (hasFb) {
            score += 5;
            notes.push('Has Facebook');
        } else {
            notes.push('Missing Facebook');
        }

        let grade = 'C';
        if (score === 10) grade = 'A';
        else if (score === 5) grade = 'B';

        return {
            ...lead,
            social_score: score.toString(),
            social_grade: grade,
            social_notes: notes.join('; ')
        };
    });

    await writeCsv(OUTPUT_FILE, audited);
    console.log(`Finished social audit. Audited ${audited.length} leads.`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
