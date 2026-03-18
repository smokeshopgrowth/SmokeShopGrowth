import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { format } from '@fast-csv/format';

/**
 * Read a CSV file into an array of row objects.
 */
export function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Input file not found: ${filePath}`));
        }
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

/**
 * Write an array of row objects to CSV.
 * If `headers` is provided, only those columns are written in that order.
 * Otherwise all keys from all rows are included.
 */
export function writeCsv(filePath, rows, headers) {
    return new Promise((resolve, reject) => {
        if (!rows.length) { resolve(); return; }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const ws = fs.createWriteStream(filePath);

        if (!headers) {
            const allKeys = new Set();
            rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
            headers = Array.from(allKeys);
        }

        const stream = format({ headers });
        stream.pipe(ws);
        for (const row of rows) stream.write(row);
        stream.end();
        ws.on('finish', resolve);
        ws.on('error', reject);
    });
}

/**
 * Count rows in a CSV file.
 */
export function countCsvRows(filePath) {
    return new Promise(resolve => {
        if (!fs.existsSync(filePath)) return resolve(0);
        let count = 0;
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', () => count++)
            .on('end', () => resolve(count))
            .on('error', () => resolve(0));
    });
}

/**
 * Escape a value for manual CSV building (legacy compat).
 */
export function escapeCSV(value) {
    const str = String(value || '');
    return `"${str.replace(/"/g, '""')}"`;
}
