# Use official Playwright Python image which includes all browser dependencies natively
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=webhook.py

# Install Node.js (required for Vercel CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g vercel

# Set work directory
WORKDIR /app

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browser binaries explicitly (dependencies are already in the base image)
RUN playwright install chromium

# Copy project files
COPY . .

# Railway sets PORT dynamically; gunicorn reads it at start
EXPOSE 8080
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:$PORT webhook:app"]
