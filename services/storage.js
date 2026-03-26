'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createLogger } = require('../utils/logger');

const logger = createLogger('StorageService');

/**
 * Handles all direct filesystem interaction for the application.
 */
class StorageService {
    constructor() {
        this.baseDataDir = path.join(__dirname, '..', 'data');
        this.baseLogDir = path.join(__dirname, '..', 'logs');
        this.deploymentsDir = path.join(__dirname, '..', 'deployments');
        
        this.ensureDir(this.baseDataDir);
        this.ensureDir(this.baseLogDir);
        this.ensureDir(this.deploymentsDir);
    }

    /**
     * Ensures an absolute path directory exists synchronously
     */
    ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * Creates a data directory for a specific job/city run
     * Returns full path strings
     */
    createJobDirectory(slug) {
        const fullDir = path.join(this.baseDataDir, slug);
        this.ensureDir(fullDir);

        return {
            fullDir,
            relativeDir: path.join('data', slug),
            files: {
                leads: path.join('data', slug, 'leads.csv'),
                audited: path.join('data', slug, 'audited_leads.csv'),
                socialAudited: path.join('data', slug, 'social_audited.csv'),
                enriched: path.join('data', slug, 'enriched_leads.csv'),
                outreach: path.join('data', slug, 'outreach_messages.csv'),
                demos: path.join('public', 'demos', slug),
                demo: path.join('data', slug, 'demo_leads.csv'),
                emailLog: path.join('logs', 'email_log.csv'),
                callLog: path.join('logs', 'call_log.csv'),
            }
        };
    }

    /**
     * Appends a JSON line to a specific log file in the base log directory
     */
    appendJsonl(logFileName, dataObject) {
        const p = path.join(this.baseLogDir, logFileName);
        try {
            fs.appendFileSync(p, JSON.stringify(dataObject) + '\n');
        } catch (err) {
            logger.error(`Failed to append to ${logFileName}`, { error: err.message });
        }
    }

    /**
     * Scaffolds a frontend deployment template for a business
     * @param {string} slug 
     * @param {string} html 
     * @param {string} configContent 
     * @param {string} templateCssPath 
     * @param {string} templateAnimPath 
     */
    scaffoldDeployment(slug, html, configContent, templateCssPath, templateAnimPath) {
        const projectPath = path.join(this.deploymentsDir, `shop-${slug}`);
        this.ensureDir(projectPath);

        fs.writeFileSync(path.join(projectPath, 'index.html'), html);
        fs.writeFileSync(path.join(projectPath, 'config.js'), configContent);
        
        if (fs.existsSync(templateCssPath)) {
            fs.copyFileSync(templateCssPath, path.join(projectPath, 'styles.css'));
        }
        if (fs.existsSync(templateAnimPath)) {
            fs.copyFileSync(templateAnimPath, path.join(projectPath, 'animations.js'));
        }

        return `/deployments/shop-${slug}/index.html`;
    }

    /**
     * Parses a CSV file and returns the rows
     */
    async readCsv(absolutePath) {
        if (!fs.existsSync(absolutePath)) return [];
        const rows = [];
        return new Promise((resolve, reject) => {
            fs.createReadStream(absolutePath)
                .pipe(csv())
                .on('data', (row) => rows.push(row))
                .on('end', () => resolve(rows))
                .on('error', reject);
        });
    }

    /**
     * Create a simple text file
     */
    writeTextFile(relativePath, content) {
        const p = path.resolve(relativePath);
        this.ensureDir(path.dirname(p));
        fs.writeFileSync(p, content);
    }
    
    /**
     * Checks if file exists
     */
    fileExists(absolutePath) {
        return fs.existsSync(absolutePath);
    }
}

module.exports = new StorageService();
