# SmokeShopGrowth.com - Production Deployment Guide

## Overview

This guide covers deploying the SmokeShopGrowth lead generation template to a production environment at smokeshopgrowth.com.

## Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Git
- A hosting provider (Heroku, Railway, DigitalOcean, AWS, etc.)
- Domain smokeshopgrowth.com registered and configured

### One-Click Deployment Options

#### Option 1: Heroku (Fastest)
```bash
# Install Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

# Clone this repo
git clone <repo-url>
cd "Build Google Maps Lead Scraper"

# Create Heroku app
heroku create smokeshopgrowth

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set PORT=3000

# Deploy
git push heroku main

# Open app
heroku open
```

#### Option 2: Railway (Recommended)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Connect to repo
# Select this repository

# Set environment variables
railway variables set NODE_ENV=production

# Deploy
railway up
```

#### Option 3: DigitalOcean App Platform
1. Sign up at https://www.digitalocean.com
2. Go to App Platform
3. Connect GitHub repo
4. Select this repository
5. Set build command: `npm install`
6. Set run command: `npm start`
7. Add environment variables
8. Deploy

### Manual Deployment (VPS)

#### 1. Server Setup
```bash
# SSH into your server
ssh root@your-server-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (process manager)
sudo npm install -g pm2

# Create app directory
mkdir -p /var/www/smokeshopgrowth
cd /var/www/smokeshopgrowth
```

#### 2. Clone & Configure
```bash
# Clone repository
git clone <repo-url> .

# Install dependencies
npm install

# Create .env.production
cat > .env.production << EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=sqlite:./data/submissions.db
ANALYTICS_ID=G-XXXXXXXXXX
EOF

# Create data directory
mkdir -p data
```

#### 3. Start Application
```bash
# Using PM2
pm2 start npm --name smokeshopgrowth -- start
pm2 save
pm2 startup

# Verify it's running
pm2 logs smokeshopgrowth
```

#### 4. Configure Reverse Proxy (Nginx)
```bash
# Install Nginx
sudo apt-get install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/smokeshopgrowth
```

Add this config:
```nginx
server {
    listen 80;
    server_name smokeshopgrowth.com www.smokeshopgrowth.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then:
```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/smokeshopgrowth /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

#### 5. Setup SSL (Free with Let's Encrypt)
```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d smokeshopgrowth.com -d www.smokeshopgrowth.com

# Auto-renewal (enabled by default)
sudo systemctl enable certbot.timer
```

## Environment Configuration

### Required Variables
```env
NODE_ENV=production              # Set to 'production'
PORT=3000                        # Server port (3000 or 80)
DATABASE_URL=sqlite:./data/submissions.db  # Database path
```

### Optional Variables
```env
ANALYTICS_ID=G-XXXXXXXXXX       # Google Analytics 4 ID
GOOGLE_SHEETS_KEY=xxxxx         # For Google Sheets export
SMTP_HOST=smtp.gmail.com        # For email notifications
SMTP_PORT=587                   # SMTP port
SMTP_USER=your-email@gmail.com  # SMTP username
SMTP_PASS=your-password         # SMTP password
```

## Database Setup

### SQLite (Default - No Setup Needed)
Database automatically created at `data/submissions.db` on first run.

### PostgreSQL (Production Recommended)
```bash
# Install PostgreSQL client
npm install pg

# Create database
createdb smokeshopgrowth

# Run migrations
npm run db:migrate

# Set connection string
export DATABASE_URL=postgresql://user:password@localhost:5432/smokeshopgrowth
```

### MySQL
```bash
# Install MySQL client
npm install mysql2

# Create database
mysql -u root -p -e "CREATE DATABASE smokeshopgrowth;"

# Set connection string
export DATABASE_URL=mysql://user:password@localhost:3306/smokeshopgrowth
```

## Production Checklist

### Security
- [ ] .env file not committed to git
- [ ] HTTPS enabled (SSL certificate)
- [ ] Strong database password set
- [ ] Rate limiting configured (default: 50 req/15 min)
- [ ] CORS configured if needed
- [ ] Environment variables set on hosting platform
- [ ] Node modules optimized (production build)

### Performance
- [ ] Node process manager configured (PM2, systemd, etc.)
- [ ] Static files served from CDN (optional)
- [ ] Database indexed for searches
- [ ] Gzip compression enabled in Nginx
- [ ] Cache headers configured
- [ ] Error tracking configured (Sentry, etc.)

### Monitoring
- [ ] Error notifications configured
- [ ] Uptime monitoring enabled
- [ ] Database backups scheduled
- [ ] Logs collected and analyzed
- [ ] Performance metrics tracked
- [ ] Alerts set up for critical issues

### Operations
- [ ] Automated backups configured
- [ ] Deployment pipeline automated
- [ ] Rollback procedure documented
- [ ] Team access configured
- [ ] Domain DNS configured
- [ ] Email notifications working

## Scaling

### As Traffic Grows

1. **Database Optimization**
   - Add indexes on frequently queried fields
   - Set up read replicas if needed
   - Archive old submissions regularly

2. **Application Scaling**
   - Run multiple Node processes (with load balancer)
   - Use PM2 cluster mode: `pm2 start server.js -i max`
   - Add Redis for session caching

3. **Infrastructure**
   - Use CDN for static assets (CloudFlare, AWS CloudFront)
   - Implement caching layer (Redis, Memcached)
   - Set up load balancer (Nginx, HAProxy)
   - Consider Kubernetes for orchestration

## Monitoring & Maintenance

### Daily
- Check error logs
- Monitor server resource usage
- Review submission volume

### Weekly
- Check database size
- Review analytics
- Test backup restoration

### Monthly
- Performance optimization review
- Security audit
- Feature updates

## Troubleshooting

### Application won't start
```bash
# Check logs
pm2 logs smokeshopgrowth

# Verify dependencies
npm install

# Check Node version
node --version  # Should be 18+
```

### Database connection error
```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL

# Check if database file exists
ls -la data/submissions.db

# Reset database
rm data/submissions.db && npm start
```

### Port already in use
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or change port in .env
PORT=3001 npm start
```

### HTTPS not working
```bash
# Check certificate
sudo certbot certificates

# Renew certificate
sudo certbot renew

# Check Nginx config
sudo nginx -t
```

## Backup & Recovery

### Automated Backups
```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/smokeshopgrowth"
mkdir -p $BACKUP_DIR
cp data/submissions.db $BACKUP_DIR/submissions-$(date +%Y%m%d-%H%M%S).db
# Keep only last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete
EOF

# Make executable
chmod +x backup.sh

# Add to cron (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /var/www/smokeshopgrowth/backup.sh
```

### Manual Backup
```bash
# Backup database
cp data/submissions.db data/submissions-backup.db

# Backup entire app
tar -czf smokeshopgrowth-backup-$(date +%Y%m%d).tar.gz /var/www/smokeshopgrowth
```

## Updates & Deployments

### Zero-Downtime Deployment
```bash
# Using PM2
pm2 reload smokeshopgrowth

# Or with Nginx upstream
# 1. Start new instance on port 3001
# 2. Update Nginx to include both ports
# 3. Gracefully reload Nginx
# 4. Stop old instance
```

## Support & Resources

- **Documentation:** See README.md, FORM_SUBMISSION_GUIDE.md
- **Issues:** Check GitHub issues
- **Hosting Docs:**
  - Heroku: https://devcenter.heroku.com
  - Railway: https://docs.railway.app
  - DigitalOcean: https://docs.digitalocean.com

## Production Monitoring Services

### Recommended Tools
- **Error Tracking:** Sentry, Rollbar, New Relic
- **Performance:** DataDog, New Relic, Elastic APM
- **Uptime:** Pingdom, Uptime Robot, StatusPage.io
- **Database:** CloudSQL monitoring, RDS monitoring
- **Logs:** CloudWatch, Logz.io, Datadog

### Basic Monitoring Setup
```javascript
// Add to server.js for error tracking
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

app.use(Sentry.Handlers.errorHandler());
```

## Contact Information

For deployment support or questions, refer to:
- Project documentation files
- Git commit history
- Issue tracker

---

**Last Updated:** 2026-03-08  
**Status:** Production Ready
