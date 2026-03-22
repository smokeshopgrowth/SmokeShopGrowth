# Use Node.js 20 with Python support for full-stack app
FROM node:20-bookworm

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production

# Install Python, pip, python-is-python3 symlink, and Chromium OS dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python-is-python3 \
    build-essential \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgtk-3-0 libx11-xcb1 libxcb-dri3-0 libxss1 libxtst6 \
    fonts-liberation xdg-utils wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Python requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# Install Playwright browser binaries
RUN python3 -m playwright install chromium

# Copy project files
COPY . .

# Create necessary directories
RUN mkdir -p /app/logs /app/data /app/deployments

# Expose port (Railway sets PORT env var, app uses it)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/api/ping', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

# Start the server
CMD ["node", "server.js"]
