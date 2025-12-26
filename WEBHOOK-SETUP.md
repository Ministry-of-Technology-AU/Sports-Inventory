# Webhook-Based Overdue Checking System

## Overview
The overdue checking system has been migrated from a cron-based scheduler to an instant webhook-based approach. This allows for real-time overdue notifications instead of waiting for scheduled checks.

## Changes Made

### 1. Removed Dependencies
- ❌ `node-cron` - No longer needed for scheduled tasks

### 2. New Webhook Endpoints

#### POST `/api/check-overdue`
Triggers an instant overdue check. Can be called:
- Automatically after equipment borrow/return operations
- By external automation services (GitHub Actions, CI/CD, etc.)
- Via webhook services (Zapier, IFTTT, etc.)

**Request:**
```bash
curl -X POST http://localhost:3000/api/check-overdue \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{}'
```

**Response:**
```json
{
  "success": true,
  "message": "Overdue check completed successfully",
  "timestamp": "2025-12-26T10:30:00.000Z"
}
```

#### GET `/api/check-overdue`
Manual trigger for admins via browser or authenticated requests.

**Usage:**
- Navigate to `http://localhost:3000/api/check-overdue` (requires admin authentication)
- Useful for testing and manual triggering

## Security Configuration

### Optional API Key Protection (Recommended for Production)

Add to your `.env` file:
```env
WEBHOOK_API_KEY=your-secure-random-key-here
```

Generate a secure key:
```bash
openssl rand -hex 32
```

## Integration Options

### 1. Automatic Trigger on Equipment Operations
Add webhook calls after borrow/return operations in your codebase:

```javascript
// After successful equipment issue/return
try {
  await fetch('http://localhost:3000/api/check-overdue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.WEBHOOK_API_KEY
    }
  });
} catch (error) {
  // Log but don't fail the main operation
  console.error('Failed to trigger overdue check:', error);
}
```

### 2. External Scheduling (Alternative to Cron)

#### GitHub Actions (Scheduled Workflow)
Create `.github/workflows/check-overdue.yml`:
```yaml
name: Check Overdue Equipment
on:
  schedule:
    - cron: '0 8,20 * * *'  # 8 AM and 8 PM UTC
  workflow_dispatch:  # Manual trigger

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Overdue Check
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/check-overdue \
            -H "x-api-key: ${{ secrets.WEBHOOK_API_KEY }}"
```

#### AWS EventBridge
Set up scheduled events to call your webhook endpoint.

#### Vercel Cron Jobs
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/check-overdue",
    "schedule": "0 8,20 * * *"
  }]
}
```

### 3. Real-time Event Triggers
Call the webhook immediately when:
- Equipment is borrowed (check if borrower has other overdue items)
- Equipment is returned (update overdue status)
- Admin manually requests check
- External systems detect relevant events

## Benefits of Webhook Approach

✅ **Instant Response** - No waiting for scheduled cron jobs
✅ **Event-Driven** - React to actual system events
✅ **Flexible** - Trigger from anywhere (external services, CI/CD, manual)
✅ **Scalable** - Works better in cloud/serverless environments
✅ **Testable** - Easy to test via HTTP requests
✅ **Cloud-Friendly** - No need for long-running cron processes

## Testing

### Local Testing
```bash
# Start your server
npm start

# In another terminal, trigger the webhook
curl -X POST http://localhost:3000/api/check-overdue \
  -H "Content-Type: application/json"
```

### Check Logs
Monitor `logs/app-log.txt` for:
```
🔔 Webhook triggered: Starting instant overdue check
🔄 Running overdue check...
📊 Found X students with overdue equipment
✅ Sent overdue notification to [Student Name]
🏁 Overdue check complete
```

## Migration Notes

- The `checkAndNotifyOverdue()` function remains unchanged
- Email sending logic is identical to the cron version
- One-email-per-day tracking still applies
- All overdue detection logic preserved

## Rollback (if needed)

If you need to revert to cron-based scheduling:

1. Reinstall node-cron:
   ```bash
   npm install node-cron
   ```

2. Restore the original cron code in app.js

## Questions?

- Check `logs/app-log.txt` for webhook execution logs
- Verify `.env` has `WEBHOOK_API_KEY` configured (optional but recommended)
- Test with the GET endpoint as an admin for quick verification
