# Automated Overdue Tracking System

## Overview
The system automatically marks equipment as overdue and sends email notifications after a configurable time threshold (default: 6 hours). This happens **instantly** using webhooks instead of scheduled cron jobs.

## Key Features

✅ **Instant Detection**: Items marked overdue exactly N hours after borrowing  
✅ **Automatic Triggers**: Runs after every borrow operation  
✅ **Database Tracked**: Persistent overdue status in database  
✅ **Smart Email**: One email per student, no duplicates  
✅ **Configurable**: Adjust time threshold via environment variable  

## How It Works

### 1. Time-Based Threshold
- Default: **6 hours** after borrowing
- Configurable via `OVERDUE_THRESHOLD_HOURS` environment variable
- Example: Item borrowed at 10:00 AM → marked overdue at 4:00 PM

### 2. Automatic Checking
The system checks for overdue items automatically:
- ✅ After every equipment borrow
- ✅ After every team equipment borrow  
- ✅ When webhook endpoint is called manually
- ✅ When called by external services (GitHub Actions, etc.)

### 3. Database Updates
Two new columns in `Logs` table:
```sql
overdue BOOLEAN NOT NULL DEFAULT FALSE          -- Is item overdue?
overdueEmailSent BOOLEAN NOT NULL DEFAULT FALSE -- Was email sent?
```

## Setup Instructions

### Step 1: Update Database Schema

Run this SQL migration:

```sql
ALTER TABLE Logs
ADD COLUMN overdue BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN overdueEmailSent BOOLEAN NOT NULL DEFAULT FALSE;
```

This is already in [TABLE-COMMANDS.md](TABLE-COMMANDS.md).

### Step 2: Configure Environment

Add to your `.env` file:

```env
# Hours before item is marked overdue (default: 6)
OVERDUE_THRESHOLD_HOURS=6

# Optional: Secure webhook with API key
WEBHOOK_API_KEY=<your-secure-key>
```

Generate a secure API key:
```bash
openssl rand -hex 32
```

### Step 3: Start Server

```bash
npm start
```

That's it! The system is now active.

## How Overdue Detection Works

### Detection Query
```sql
SELECT * FROM Logs
WHERE pending = TRUE 
  AND returned = FALSE
  AND overdue = FALSE
  AND timestamp <= (NOW() - INTERVAL 6 HOUR)
```

Finds items that:
- ✅ Are still out (not returned)
- ✅ Not yet marked overdue
- ✅ Borrowed 6+ hours ago

### Update to Overdue
```sql
UPDATE Logs 
SET overdue = TRUE 
WHERE logID IN (identified_items)
```

### Send Email Notifications
- Groups overdue items by student
- Sends one email per student
- Marks: `overdueEmailSent = TRUE`
- Won't resend for same items

## API Reference

### POST `/api/check-overdue`

Trigger instant overdue check (with optional API key).

**Request:**
```bash
curl -X POST http://localhost:3000/api/check-overdue \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY"
```

**Response:**
```json
{
  "success": true,
  "message": "Automated overdue check completed",
  "timestamp": "2025-12-26 15:30:00",
  "data": {
    "itemsMarkedOverdue": 5,
    "emailsSent": 2,
    "overdueThreshold": "6 hours"
  }
}
```

### GET `/api/check-overdue`

Manual trigger for admins (requires login).

**Usage:**
- Visit `http://localhost:3000/api/check-overdue` as admin
- Same JSON response as POST

## Automatic Triggering

The system automatically checks after borrowing:

```javascript
// src/app.js - After successful equipment issue
autoTriggerOverdueCheck();
```

This runs in the background without blocking the response.

**Triggers on:**
- Regular equipment borrow (`/issue`)
- Team equipment borrow (`/issue_team_equipment`)

## External Scheduling (Optional)

While the system auto-triggers after borrows, you can also schedule regular checks:

### GitHub Actions

Create `.github/workflows/check-overdue.yml`:

```yaml
name: Check Overdue Equipment
on:
  schedule:
    - cron: '0 */3 * * *'  # Every 3 hours
  workflow_dispatch:       # Manual trigger

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Overdue Check
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/check-overdue \
            -H "x-api-key: ${{ secrets.WEBHOOK_API_KEY }}"
```

### AWS EventBridge
Schedule periodic webhook calls to your endpoint.

### Vercel Cron
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/check-overdue",
    "schedule": "0 */3 * * *"
  }]
}
```

## Testing

### Test the webhook manually:
```bash
# Start server
npm start

# In another terminal
curl -X POST http://localhost:3000/api/check-overdue
```

### Check logs:
```bash
tail -f logs/app-log.txt
```

Expected output:
```
🔔 Webhook triggered: Starting automated overdue check
🔄 Running automated overdue check (threshold: 6 hours)...
📊 Found 3 items to mark as overdue
✅ Marked 3 items as overdue in database
✅ Sent overdue notification to John Doe
🏁 Overdue check complete - Marked: 3, Emails sent: 1
```

### Test automatic triggering:
1. Borrow equipment via the UI
2. Check logs - you'll see:
```
🔄 Auto-triggering overdue check after equipment operation...
```

## Example Timeline

**User borrows basketball at 10:00 AM:**
```
10:00 AM - Equipment borrowed
10:00 AM - Auto overdue check runs (nothing overdue yet)
```

**System checks at 4:00 PM (6 hours later):**
```
4:00 PM - User borrows football (triggers check)
4:00 PM - System detects basketball is 6+ hours old
4:00 PM - Marks basketball as overdue
4:00 PM - Sends email to user
```

**User returns basketball at 5:00 PM:**
```
5:00 PM - Basketball returned
5:00 PM - overdue flag stays TRUE (historical record)
5:00 PM - pending = FALSE, returned = TRUE
```

## Advantages Over Cron

| Feature | Cron (Old) | Webhook (New) |
|---------|------------|---------------|
| Timing | Fixed schedule (8AM, 8PM) | Instant after borrow |
| Accuracy | Check twice daily | Check when needed |
| Trigger | Time-based | Event-driven |
| Cloud | Requires long-running process | Serverless-friendly |
| Testing | Wait for schedule | Instant via curl |
| Flexibility | Rigid schedule | On-demand + scheduled |

## Troubleshooting

### Items not being marked overdue?

Check:
1. Database has new columns: `overdue`, `overdueEmailSent`
2. Environment variable set: `OVERDUE_THRESHOLD_HOURS`
3. Logs show check running: `tail -f logs/app-log.txt`

### Emails not sending?

Check:
1. Items marked `overdue = TRUE` in database
2. Items not already marked `overdueEmailSent = TRUE`
3. Email configuration in `.env` file

### Webhook returns 401 Unauthorized?

Check:
1. `WEBHOOK_API_KEY` matches in `.env` and request header
2. Header name is exactly `x-api-key`

## Database Queries

### See all overdue items:
```sql
SELECT studentName, equipmentBorrowed, timestamp, 
       TIMESTAMPDIFF(HOUR, timestamp, NOW()) as hoursElapsed
FROM Logs
WHERE overdue = TRUE AND returned = FALSE
ORDER BY timestamp ASC;
```

### See items about to be overdue:
```sql
SELECT studentName, equipmentBorrowed, timestamp,
       TIMESTAMPDIFF(HOUR, timestamp, NOW()) as hoursElapsed
FROM Logs
WHERE pending = TRUE 
  AND returned = FALSE
  AND overdue = FALSE
  AND TIMESTAMPDIFF(HOUR, timestamp, NOW()) >= 5
ORDER BY timestamp ASC;
```

### Reset overdue status (testing):
```sql
UPDATE Logs 
SET overdue = FALSE, overdueEmailSent = FALSE 
WHERE logID = ?;
```

## Security

### API Key Authentication
- POST endpoint accepts API key via header or body
- GET endpoint requires admin OAuth session
- Both protect against unauthorized triggers

### Recommendation
Always set `WEBHOOK_API_KEY` in production to prevent abuse.

## Questions?

- Check `logs/app-log.txt` for detailed execution logs
- Query database to see overdue status
- Test webhook via curl or browser (as admin)
- Verify environment variables in `.env`
