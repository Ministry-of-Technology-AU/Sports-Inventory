/**
 * Helper function to trigger overdue check webhook
 * Call this after equipment borrow/return operations
 */
async function triggerOverdueCheck() {
  try {
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/check-overdue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.WEBHOOK_API_KEY || ''
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Overdue check triggered:', data.message);
    }
  } catch (error) {
    // Don't fail the main operation if webhook fails
    console.error('⚠️ Failed to trigger overdue check:', error.message);
  }
}

// Example usage in your equipment routes:

// After successful equipment issue
app.post("/issue", async (req, res) => {
  // ... existing issue logic ...
  
  // After equipment is issued successfully:
  await triggerOverdueCheck();
  
  // ... continue with response ...
});

// After successful equipment return
app.post("/return_equipment", async (req, res) => {
  // ... existing return logic ...
  
  // After equipment is returned successfully:
  await triggerOverdueCheck();
  
  // ... continue with response ...
});

// You can also trigger it periodically via external services:
// - GitHub Actions cron job
// - AWS EventBridge
// - Vercel Cron
// - Manual admin trigger

module.exports = { triggerOverdueCheck };
