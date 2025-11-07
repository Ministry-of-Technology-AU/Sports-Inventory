# Railway MySQL Connection Troubleshooting Guide

## Issue: `ETIMEDOUT` or `SSL connection error`

Your application is experiencing connection timeouts when trying to connect to Railway MySQL. Here's how to fix it:

## Most Common Causes

### 1. **Railway Service is Paused** (Most Likely!)
- Railway pauses services on the free tier after inactivity
- **Solution**: Visit https://railway.app/dashboard and check if your MySQL service is paused
- Click on your project → MySQL service → Resume if it's paused

### 2. **Check Service Status**
```bash
# Test if the port is accessible
nc -zv -w 5 caboose.proxy.rlwy.net 24631

# If this times out, the service is definitely down/paused
```

### 3. **Verify Credentials**
Your current credentials from `.env`:
- Host: `caboose.proxy.rlwy.net`
- Port: `24631`
- User: `root`
- Database: `sportsinventory`

**To verify these are current:**
1. Go to https://railway.app/dashboard
2. Select your project
3. Click on MySQL service
4. Go to "Variables" tab
5. Compare values with your `.env` file

## Quick Fixes

### Option 1: Use Railway CLI (Recommended)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Connect to MySQL directly
railway connect mysql
```

### Option 2: Update SSL Configuration
If Railway has changed SSL requirements, try these settings in your code:

**For mysql2 (Promise-based):**
```javascript
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 30000,
  // Try these SSL variations
  ssl: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  }
});
```

**Or disable SSL entirely (not recommended for production):**
```javascript
ssl: false  // Only for testing!
```

### Option 3: Check Railway Connection Limits
- Free tier has connection limits
- Check if you're hitting the limit
- Close unused connections in your code

## Testing Steps

### 1. Test Railway Service Status
```bash
# Check if Railway service is responding
curl -I https://caboose.proxy.rlwy.net/ 2>&1 | head -5
```

### 2. Test MySQL Connection
```bash
# Install mysql client if needed
brew install mysql-client

# Test connection (replace with your actual password)
mysql -h caboose.proxy.rlwy.net \
      -P 24631 \
      -u root \
      -p \
      sportsinventory \
      -e "SELECT 1 as test;"
```

### 3. Check Application Logs
Your app now has better logging. Check:
```bash
tail -f logs/email-log.txt
```

## What We've Fixed in Your Code

✅ **Added SSL configuration** with proper TLS version
✅ **Added retry logic** with exponential backoff (3 attempts)
✅ **Better error messages** that tell you what's wrong
✅ **Graceful degradation** - app continues running even if DB fails
✅ **Helpful hints** in error messages

## Alternative: Use Local MySQL for Development

If Railway continues to have issues, switch to local MySQL:

```bash
# Install MySQL locally
brew install mysql

# Start MySQL
brew services start mysql

# Create database
mysql -u root -e "CREATE DATABASE sportsinventory;"

# Import your schema
mysql -u root sportsinventory < your_schema.sql

# Update .env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=sportsinventory
```

## Still Having Issues?

1. **Check Railway Dashboard**: https://railway.app/dashboard
2. **Check Railway Status Page**: https://status.railway.app/
3. **Railway Discord**: Join for support
4. **Check if you've exceeded free tier limits**

## Contact Railway Support

If the service should be running but isn't:
- Email: team@railway.app
- Discord: https://discord.gg/railway
- Include your project ID and error messages
