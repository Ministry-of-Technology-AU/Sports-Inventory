import moment from "moment-timezone";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { logToFile } from "../utils/logger.js";
import { sendTeamOverdueEmail, sendOverdueEmail } from "../utils/email.js";
import prisma from "../prisma.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

// Configuration: Time threshold for marking items overdue
// Supports decimal values for minute-level testing (e.g., 0.5 = 30 minutes, 0.0167 = 1 minute)
// Can also use OVERDUE_THRESHOLD_MINUTES for direct minute values
export const OVERDUE_THRESHOLD_HOURS = parseFloat(process.env.OVERDUE_THRESHOLD_HOURS || "6");
export const OVERDUE_THRESHOLD_MINUTES = process.env.OVERDUE_THRESHOLD_MINUTES 
  ? parseFloat(process.env.OVERDUE_THRESHOLD_MINUTES) 
  : OVERDUE_THRESHOLD_HOURS * 60;

// Store scheduled overdue timeouts (logID -> timeout handle)
const overdueTimeouts = new Map();

/**
 * Schedule an overdue check for a specific log entry at its exact overdue time
 * @param {number} logID - The log entry ID
 * @param {Date|string} issueTime - When the item was issued (timestamp)
 */
export function scheduleOverdueTimeout(logID, issueTime) {
  // Cancel any existing timeout for this logID
  if (overdueTimeouts.has(logID)) {
    clearTimeout(overdueTimeouts.get(logID));
    overdueTimeouts.delete(logID);
  }

  const issueMoment = moment(issueTime).tz("Asia/Kolkata");
  const overdueTime = issueMoment.clone().add(OVERDUE_THRESHOLD_MINUTES, "minutes");
  const now = moment().tz("Asia/Kolkata");
  const msUntilOverdue = overdueTime.diff(now);

  // Format for logging
  const thresholdDisplay = OVERDUE_THRESHOLD_MINUTES < 60 
    ? `${OVERDUE_THRESHOLD_MINUTES} minutes` 
    : `${OVERDUE_THRESHOLD_HOURS} hours`;

  if (msUntilOverdue <= 0) {
    // Already past overdue time - trigger immediately
    logToFile(`⏰ Log #${logID}: Already past overdue time (threshold: ${thresholdDisplay}), processing now...`);
    setImmediate(() => processOverdueItem(logID));
  } else {
    // Schedule for exact overdue time
    const timeDisplay = msUntilOverdue < 60000 
      ? `${Math.round(msUntilOverdue / 1000)} seconds`
      : `${Math.round(msUntilOverdue / 60000)} minutes`;
    logToFile(`⏰ Log #${logID}: Scheduled overdue check in ${timeDisplay} (at ${overdueTime.format("h:mm:ss A")})`);
    
    const timeoutHandle = setTimeout(() => {
      overdueTimeouts.delete(logID);
      processOverdueItem(logID);
    }, msUntilOverdue);
    
    overdueTimeouts.set(logID, timeoutHandle);
  }
}

/**
 * Cancel a scheduled overdue timeout (e.g., when item is returned)
 * @param {number} logID - The log entry ID
 */
export function cancelOverdueTimeout(logID) {
  if (overdueTimeouts.has(logID)) {
    clearTimeout(overdueTimeouts.get(logID));
    overdueTimeouts.delete(logID);
    logToFile(`✅ Log #${logID}: Overdue timeout cancelled (item returned)`);
  }
}

/**
 * Process a single item that has become overdue
 * @param {number} logID - The log entry ID to mark as overdue
 */
export async function processOverdueItem(logID) {
  try {
    // Get the log entry details with student and equipment info
    const logEntry = await prisma.log.findUnique({
      where: { logID: logID },
      include: {
        student: { select: { studentName: true, studentEmail: true } },
        equipment: { select: { name: true } },
      },
    });

    if (!logEntry) {
      logToFile(`⚠️ Log #${logID}: Not found in database`);
      return;
    }

    // Check if item is still pending
    if (logEntry.status !== "pending") {
      logToFile(`⏭️ Log #${logID}: Skipped (status=${logEntry.status})`);
      return;
    }

    // Mark as overdue
    await prisma.log.update({
      where: { logID: logID },
      data: { status: "overdue" },
    });
    logToFile(`🔴 Log #${logID}: Marked as OVERDUE - ${logEntry.equipment.name} borrowed by ${logEntry.student.studentName}`);

    // Send overdue email
    const equipment = { [logEntry.equipment.name]: 1 };
    
    if (logEntry.isTeamIssue) {
      const issueTime = moment(logEntry.timestamp).tz("Asia/Kolkata");
      const issueDate = issueTime.format("MMMM D, YYYY h:mm A");
      const expectedReturn = issueTime.clone().add(OVERDUE_THRESHOLD_MINUTES, "minutes").format("MMMM D, YYYY h:mm A");
      
      await sendTeamOverdueEmail(
        logEntry.student.studentEmail,
        logEntry.student.studentName,
        "Sports Team",
        logEntry.equipment.name,
        equipment,
        issueDate,
        expectedReturn,
        1
      );
    } else {
      await sendOverdueEmail(
        logEntry.student.studentEmail,
        logEntry.student.studentName,
        equipment,
        logEntry.equipment.name
      );
    }

    // Mark email as sent
    await prisma.log.update({
      where: { logID: logID },
      data: { overdueEmailSent: true },
    });
    logToFile(`📧 Log #${logID}: Overdue email sent to ${logEntry.student.studentEmail}`);

  } catch (error) {
    logToFile(`❌ Log #${logID}: Error processing overdue - ${error.message}`);
  }
}

/**
 * Reschedule overdue timeouts for all pending items on server startup
 */
export async function rescheduleAllOverdueTimeouts() {
  try {
    logToFile("🔄 Rescheduling overdue timeouts for all pending items...");
    
    const pendingItems = await prisma.log.findMany({
      where: { status: "pending" },
      select: { logID: true, timestamp: true },
    });

    if (pendingItems.length === 0) {
      logToFile("   ✅ No pending items to schedule");
      return;
    }

    logToFile(`   📊 Found ${pendingItems.length} pending items`);
    
    for (const item of pendingItems) {
      scheduleOverdueTimeout(item.logID, item.timestamp);
    }

    logToFile(`   ✅ Scheduled ${pendingItems.length} overdue timeouts`);
  } catch (error) {
    logToFile(`❌ Error rescheduling overdue timeouts: ${error.message}`);
  }
}

/**
 * Batch check and mark all overdue items (for manual/webhook triggering)
 * Note: Individual items are now auto-scheduled via setTimeout on issue
 * This function is kept for manual admin checks and catching any missed items
 */
export async function checkAndMarkOverdueItems() {
  try {
    // Format threshold for logging (show minutes if less than 1 hour)
    const thresholdDisplay = OVERDUE_THRESHOLD_MINUTES < 60 
      ? `${OVERDUE_THRESHOLD_MINUTES} minutes` 
      : `${OVERDUE_THRESHOLD_HOURS} hours (${OVERDUE_THRESHOLD_MINUTES} minutes)`;
    logToFile(`🔄 Running automated overdue check (threshold: ${thresholdDisplay})...`);

    const now = moment().tz("Asia/Kolkata");
    
    // Calculate the overdue threshold time using minutes for precision
    const overdueThreshold = now.clone()
      .subtract(OVERDUE_THRESHOLD_MINUTES, "minutes")
      .toDate();

    // Find items that are still pending and were issued more than threshold minutes ago
    const itemsToMarkOverdue = await prisma.log.findMany({
      where: {
        status: "pending",
        timestamp: { lte: overdueThreshold },
      },
      include: {
        student: { select: { studentID: true, studentName: true, studentEmail: true } },
        equipment: { select: { name: true } },
      },
      orderBy: { timestamp: "asc" },
    });

    if (itemsToMarkOverdue.length === 0) {
      logToFile("   ✅ No new items to mark as overdue");
      return { success: true, markedOverdue: 0, emailsSent: 0 };
    }

    logToFile(`   📊 Found ${itemsToMarkOverdue.length} items to mark as overdue`);

    // Update all these items to overdue status
    const logIDs = itemsToMarkOverdue.map(item => item.logID);
    
    await prisma.log.updateMany({
      where: { logID: { in: logIDs } },
      data: { status: "overdue" },
    });

    logToFile(`   ✅ Marked ${logIDs.length} items as overdue in database`);

    // Group by student for email notifications
    const studentOverdueMap = new Map();
    const teamOverdueMap = new Map();

    itemsToMarkOverdue.forEach((item) => {
      if (item.isTeamIssue) {
        // Team equipment
        if (!teamOverdueMap.has(item.studentID)) {
          teamOverdueMap.set(item.studentID, {
            studentEmail: item.student.studentEmail,
            studentName: item.student.studentName,
            equipment: {},
            oldestTimestamp: item.timestamp,
            logIDs: []
          });
        }
        const student = teamOverdueMap.get(item.studentID);
        student.equipment[item.equipment.name] = (student.equipment[item.equipment.name] || 0) + 1;
        student.logIDs.push(item.logID);
      } else {
        // Regular equipment
        if (!studentOverdueMap.has(item.studentID)) {
          studentOverdueMap.set(item.studentID, {
            studentEmail: item.student.studentEmail,
            studentName: item.student.studentName,
            equipment: {},
            primaryEquipment: item.equipment.name,
            logIDs: []
          });
        }
        const student = studentOverdueMap.get(item.studentID);
        student.equipment[item.equipment.name] = (student.equipment[item.equipment.name] || 0) + 1;
        student.logIDs.push(item.logID);
      }
    });

    let emailsSent = 0;

    // Send emails for regular equipment (one per student)
    for (const [studentID, data] of studentOverdueMap.entries()) {
      // Check if we already sent email for these specific items
      const alreadySentCount = await prisma.log.count({
        where: {
          logID: { in: data.logIDs },
          overdueEmailSent: true,
        },
      });

      if (alreadySentCount === data.logIDs.length) {
        logToFile(`   ⏭️  Skipping ${data.studentName} - email already sent for these items`);
        continue;
      }

      // Send overdue email
      const result = await sendOverdueEmail(
        data.studentEmail,
        data.studentName,
        data.equipment,
        data.primaryEquipment
      );

      if (result.success) {
        // Mark these specific log entries as emailed
        await prisma.log.updateMany({
          where: { logID: { in: data.logIDs } },
          data: { overdueEmailSent: true },
        });
        emailsSent++;
        logToFile(`   ✅ Sent overdue notification to ${data.studentName}`);
      }
    }

    // Send emails for team equipment
    for (const [studentID, data] of teamOverdueMap.entries()) {
      // Check if we already sent email for these specific items
      const alreadySentCount = await prisma.log.count({
        where: {
          logID: { in: data.logIDs },
          overdueEmailSent: true,
        },
      });

      if (alreadySentCount === data.logIDs.length) {
        logToFile(`   ⏭️  Skipping team captain ${data.studentName} - email already sent`);
        continue;
      }

      // Calculate hours overdue
      const issueTime = moment(data.oldestTimestamp).tz("Asia/Kolkata");
      const hoursOverdue = now.diff(issueTime, "hours");
      const daysOverdue = Math.floor(hoursOverdue / 24);

      // Format dates
      const issueDate = issueTime.format("MMMM D, YYYY h:mm A");
      const expectedReturn = issueTime.clone()
        .add(OVERDUE_THRESHOLD_MINUTES, "minutes")
        .format("MMMM D, YYYY h:mm A");

      const teamName = "Sports Team";
      const sportType = Object.keys(data.equipment).join(", ");

      // Send team overdue email
      const result = await sendTeamOverdueEmail(
        data.studentEmail,
        data.studentName,
        teamName,
        sportType,
        data.equipment,
        issueDate,
        expectedReturn,
        Math.max(daysOverdue, 1) // At least 1 day for display
      );

      if (result.success) {
        // Mark these specific log entries as emailed
        await prisma.log.updateMany({
          where: { logID: { in: data.logIDs } },
          data: { overdueEmailSent: true },
        });
        emailsSent++;
        logToFile(`   ✅ Sent team overdue notification to ${data.studentName}`);
      }
    }

    logToFile(`🏁 Overdue check complete - Marked: ${logIDs.length}, Emails sent: ${emailsSent}`);
    
    return {
      success: true,
      markedOverdue: logIDs.length,
      emailsSent: emailsSent,
      threshold: thresholdDisplay,
      thresholdMinutes: OVERDUE_THRESHOLD_MINUTES
    };
    
  } catch (error) {
    logToFile(`❌ Error in overdue check: ${error.message}`);
    console.error("Overdue check error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Schedule overdue timeouts for recently issued items
 * Call this after equipment borrow operations
 * Fetches the most recent log entries and schedules timeouts for them
 */
export async function scheduleOverdueForRecentIssues(studentID) {
  try {
    // Get recent pending items for this student that don't have scheduled timeouts
    const recentItems = await prisma.log.findMany({
      where: {
        studentID: studentID,
        status: "pending",
      },
      select: { logID: true, timestamp: true },
      orderBy: { logID: "desc" },
      take: 50,
    });

    for (const item of recentItems) {
      if (!overdueTimeouts.has(item.logID)) {
        scheduleOverdueTimeout(item.logID, item.timestamp);
      }
    }
  } catch (error) {
    logToFile(`⚠️ Error scheduling overdue for recent issues: ${error.message}`);
  }
}
