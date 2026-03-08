# Form Submission System Guide

## Overview

The SmokeShopGrowth template now includes a complete form submission system that captures lead information without requiring external services (SendGrid, Twilio).

## Frontend Integration

### Form Structure
The template includes a contact form with:
- **Shop Name** - Required, min 2 characters
- **City** - Required, non-empty
- **Phone** - Required, valid format (10+ digits, spaces, parentheses, hyphens)
- **Email** - Required, valid email format

### Validation
- **Real-time validation** on blur (not keyup for performance)
- **Error messages** displayed below each field
- **Submit button disabled** until form is valid
- **Visual feedback** with color coding (red for errors)

### Form Submission Flow
1. User fills out form
2. Client-side validation runs on blur
3. User clicks "Launch My Website"
4. Form data sent to `/api/template-submission` via POST
5. Button shows "Submitting..." state
6. Server validates and stores submission
7. Success message replaces form
8. Google Analytics conversion tracked (if configured)

## Backend Implementation

### Endpoint: POST /api/template-submission

**Request Body:**
```json
{
  "shopName": "My Smoke Shop",
  "city": "Denver",
  "phone": "(303) 123-4567",
  "email": "owner@smokeshop.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Thank you! We'll contact you shortly.",
  "submissionId": "abc123xyz789"
}
```

**Error Response (400/500):**
```json
{
  "error": "Missing required fields"
}
```

### Rate Limiting
- **Limit:** 50 requests per 15 minutes
- **Applied to:** All form submissions
- **Purpose:** Prevent spam/abuse

### Data Storage
- Submissions stored in-memory in `templateSubmissions` array
- Each submission includes:
  - Unique ID
  - Shop name (trimmed)
  - City (trimmed)
  - Phone (trimmed)
  - Email (trimmed)
  - ISO timestamp

### Admin Endpoint: GET /api/template-submissions

Returns all submissions received:
```json
{
  "count": 5,
  "submissions": [
    {
      "id": "abc123xyz789",
      "shopName": "My Smoke Shop",
      "city": "Denver",
      "phone": "(303) 123-4567",
      "email": "owner@smokeshop.com",
      "timestamp": "2026-03-08T04:04:07.169Z"
    }
  ]
}
```

## Usage

### Running the Server
```bash
npm start
```

Server starts on port 3000 (or PORT env var)

### Testing the Endpoint
```bash
curl -X POST http://localhost:3000/api/template-submission \
  -H "Content-Type: application/json" \
  -d '{
    "shopName": "Test Shop",
    "city": "TestCity",
    "phone": "1234567890",
    "email": "test@example.com"
  }'
```

### Viewing Submissions
```bash
curl http://localhost:3000/api/template-submissions
```

## Error Handling

### Client-side Errors
- **Missing fields:** Form won't submit, shows "required" errors
- **Invalid format:** Specific error message for each field type
- **Network error:** "Failed to submit form. Please try again."
- **Server error:** Shows error message from server

### Server-side Errors
- **Missing fields:** 400 status, error message
- **Processing error:** 500 status, generic error message
- **Rate limited:** 429 status (from rate limiter)

## Customization

### Disable Form Submission
Edit `template/index.html` around line 463, remove the fetch call:
```javascript
// Just show success message without posting
form.innerHTML = '<div class="text-center">✓ Request Received!</div>';
```

### Persist Data
Replace in-memory storage in `server.js`:
```javascript
// Current: const templateSubmissions = [];

// Option 1: File-based (append to JSON)
// Option 2: Database (MongoDB, PostgreSQL, etc.)
// Option 3: CSV export
// Option 4: Google Sheets API
```

### Change Field Requirements
Modify validation regex in `template/index.html` around line 431:
```javascript
// Phone validation
const phoneRegex = /^[\d\s()+-]{10,}$/;
// Change minimum length or allowed characters
```

### Modify Success Message
Edit `template/index.html` around line 495:
```javascript
form.innerHTML = '<div>Custom success message here</div>';
```

## Analytics Integration

### Google Analytics
If Google Analytics 4 is configured via `analyticsId` parameter:
```javascript
gtag('event', 'form_submit', {
  'event_category': 'engagement',
  'event_label': 'website_inquiry'
});
```

Tracks conversion in GA4 events.

## Security Notes

### No External Dependencies
- ✓ SendGrid removed
- ✓ Twilio removed
- ✓ No API keys required for form submissions
- ✓ No third-party tracking of submission data

### Data Privacy
- Submissions stored only in-memory
- Data lost on server restart
- No automatic retention/archival
- Consider implementing data persistence if long-term storage needed

### Validation
- Both client-side (UX) and server-side (security)
- Email format validated but not verified
- Phone format validated but not verified
- No rate limiting bypass possible

## Next Steps

### To Add Email Notifications
Implement a mail service without external APIs:
1. Use Node.js `nodemailer` package
2. Configure SMTP (Gmail, Outlook, company mail server)
3. Add to `/api/template-submission` after storing submission

### To Add Database Persistence
1. Choose database (SQLite for simple, PostgreSQL for production)
2. Create submissions table
3. Replace in-memory array with database insert
4. Add data export/admin features

### To Add Admin Dashboard
Create protected admin interface to:
1. View all submissions
2. Export as CSV/Excel
3. Mark as contacted/resolved
4. Add notes/follow-up status

## Troubleshooting

**Form submits but shows error:**
- Check server logs for validation errors
- Verify phone number format (10+ digits)
- Verify email format (user@domain.com)

**Form doesn't submit:**
- Check browser console for JavaScript errors
- Verify all required fields filled
- Check network tab to see if POST request sent

**Endpoint returns 429 (rate limited):**
- Wait 15 minutes before retrying
- Check current submission count
- Implement request queuing if high volume expected

**Server not responding:**
- Verify server started: `npm start`
- Check port 3000 is available
- Review server logs for errors
