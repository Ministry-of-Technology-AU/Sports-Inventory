import express from "express";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";
import passport from "./passport-auth.js";
import MySQLStore from "express-mysql-session";
import nodemailer from "nodemailer";

console.log("Running");
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

const port = process.env.PORT || 3000;

// Database connection
import { createPool } from "mysql2/promise";
const pool = createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Wrapper to support both callback-based and promise-based queries
const db = {
  query: (sql, argsOrCallback, callback) => {
    let args = [];
    let cb = null;

    // Detect calling pattern
    if (typeof argsOrCallback === "function") {
      // Pattern: db.query(sql, callback)
      args = [];
      cb = argsOrCallback;
    } else if (typeof callback === "function") {
      // Pattern: db.query(sql, args, callback)
      args = argsOrCallback || [];
      cb = callback;
    } else {
      // Pattern: db.query(sql, args) - expecting a promise
      args = argsOrCallback || [];
    }

    const promise = pool.query(sql, args).then(([results]) => results);

    if (cb) {
      // Callback-based: handle with callback
      promise
        .then((results) => cb(null, results))
        .catch((err) => cb(err, null));
    } else {
      // Promise-based: return promise for await
      return promise;
    }
  },
};

app.set("view engine", "ejs");

const MySQLStoreSession = MySQLStore(session);
const sessionStoreOptions = {
  schema: {
    tableName: "sessions",
    columnNames: {
      session_id: "session_id",
      expires: "expires",
      data: "data",
    },
  },
  expiration: 7 * 24 * 60 * 60 * 1000, // 1 week
  checkExpirationInterval: 15 * 60 * 1000, // 15 minutes
  createDatabaseTable: true,
};

// Basic setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = new MySQLStoreSession(sessionStoreOptions, pool);

// ========================================================
// LOGGING SETUP
// ========================================================

const LOGS_DIR = path.join(__dirname, "../logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
const LOG_FILE = path.join(LOGS_DIR, "app-log.txt");

function logToFile(msg) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  console.log(msg);
}

// ========================================================
// EMAIL SETUP (NODEMAILER)
// ========================================================

// Create nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Load email templates
const BORROW_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../templates/borrow.html"),
  "utf-8"
);
const RETURN_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../templates/return.html"),
  "utf-8"
);
const OVERDUE_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../templates/overdue.html"),
  "utf-8"
);
const TEAM_BORROW_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../templates/team-borrow.html"),
  "utf-8"
);
const TEAM_RETURN_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../templates/team-return.html"),
  "utf-8"
);
const TEAM_OVERDUE_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../templates/team-overdue.html"),
  "utf-8"
);

/**
 * Send borrow confirmation email
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 */
async function sendBorrowEmail(studentEmail, studentName, equipmentCounts) {
  try {
    // Format equipment list with each item on a new line (e.g., "Cricket Bat - 2<br>Basketball - 1")
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = BORROW_TEMPLATE.replace(/{{name}}/g, studentName).replace(
      /{{borrowedEquipment}}/g,
      equipmentList
    );

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "Sports Equipment Borrowed - Confirmation",
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Borrow email sent to ${studentEmail} - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send borrow email to ${studentEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send return confirmation email
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 */
async function sendReturnEmail(studentEmail, studentName, equipmentCounts) {
  try {
    // Format equipment list with each item on a new line (e.g., "Cricket Bat - 2<br>Football - 1")
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = RETURN_TEMPLATE.replace(/{{name}}/g, studentName).replace(
      /{{returnedEquipment}}/g,
      equipmentList
    );

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "Sports Equipment Returned - Confirmation",
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Return email sent to ${studentEmail} - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send return email to ${studentEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send overdue equipment reminder email
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 */
async function sendOverdueEmail(
  studentEmail,
  studentName,
  equipmentCounts,
  equipmentName
) {
  try {
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // HARDCODED IMAGE IF–ELSE
    // ---------------- IMAGE SELECTION (HARDCODED) ----------------

    let equipmentImagePath =
      "https://drive.google.com/uc?export=view&id=10W82tiSEfcINQEy6AAe2jAcBoGGcpyIR"; // general

    if (equipmentName === "Badminton Racquet") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1mJcg3_qUtke7iz9iya5SG-OjvdDpkY0K";
    } else if (equipmentName === "Basketball") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1TrnTTw-rCgoyFkTV7HzaIBs_dIR5FHL6";
    } else if (equipmentName === "Boxing Gloves") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1CYAP4Tx-zrj7ipuTjxRjtpvDn4vAvieg";
    } else if (
      equipmentName === "Cricket Bat" ||
      equipmentName === "Cricket Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1cJqY8Pfli5oJEcvuBptTmSubFhNo8pws";
    } else if (equipmentName === "Cycle") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1DDy9kjcNDp51V1hXFe21dlPKIh0Ih7Zq";
    } else if (equipmentName === "Foosball") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1dOPtDcBbOMrohMzi14wn725z3HyQRQEd";
    } else if (equipmentName === "Football") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1IGvOHd627ujDZogrenAUmYuOZV6yKRPY";
    } else if (equipmentName === "Frisbee") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1uaG2Um75NRF13Xk3i6bOxGAkx-QNQPpx";
    } else if (
      equipmentName === "Pickleball Racquet" ||
      equipmentName === "Pickleball Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1oOdOcaQunEyE_medViokQfMRgKXhkEjK";
    } else if (equipmentName === "Pool Stick") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=11tlNWOifsVCoivKdDsf6_VoR6MsE7H35";
    } else if (
      equipmentName === "Squash Racquet" ||
      equipmentName === "Squash Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1XYdjJkYnfGBxaVFnuZR2kqrbHQAAu_Dd";
    } else if (
      equipmentName === "Tennis Racquet" ||
      equipmentName === "Tennis Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=12H1lzn4c46xdejtOz3UvrKcksHjrMUpt";
    } else if (
      equipmentName === "Table Tennis Racquet" ||
      equipmentName === "Table Tennis Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1zXgG2StDcAg91CmKGbb000-1yw3SvlPr";
    } else if (equipmentName === "Volleyball") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1mQra8FmIARyQ0pObY_Nj_q05yQbH6RFD";
    } else if (equipmentName === "Yoga Mat") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1Y9IpuNpn6_li9xsWnGNnUW3FvumusS1h";
    }

    // -------------------------------------------------------------

    const emailHtml = OVERDUE_TEMPLATE.replace(/{{name}}/g, studentName)
      .replace(/{{pendingEquipment}}/g, equipmentList)
      .replace(/{{equipmentImage}}/g, equipmentImagePath);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "⚠️ Sports Equipment Overdue - Return Required",
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(`📧 Overdue email sent to ${studentEmail} for ${equipmentName}`);
    return { success: true };
  } catch (error) {
    logToFile(
      `❌ Failed to send overdue email to ${studentEmail}: ${error.message}`
    );
    return { success: false };
  }
}

/**
 * Send team borrow confirmation email
 * @param {string} captainEmail - Team captain's email address
 * @param {string} captainName - Team captain's name
 * @param {string} teamName - Team name
 * @param {string} sportType - Sport type
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 * @param {string} issueDate - Date equipment was issued
 * @param {string} returnDate - Expected return date
 */
async function sendTeamBorrowEmail(
  captainEmail,
  captainName,
  teamName,
  sportType,
  equipmentCounts,
  issueDate,
  returnDate
) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = TEAM_BORROW_TEMPLATE.replace(
      /{{captainName}}/g,
      captainName
    )
      .replace(/{{teamName}}/g, teamName)
      .replace(/{{sportType}}/g, sportType)
      .replace(/{{borrowedEquipment}}/g, equipmentList)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{returnDate}}/g, returnDate);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: captainEmail,
      subject: `Team Equipment Borrowed - ${teamName}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Team borrow email sent to ${captainEmail} (${teamName}) - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send team borrow email to ${captainEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send team return confirmation email
 * @param {string} captainEmail - Team captain's email address
 * @param {string} captainName - Team captain's name
 * @param {string} teamName - Team name
 * @param {string} sportType - Sport type
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 * @param {string} issueDate - Original issue date
 * @param {string} returnDate - Date equipment was returned
 * @param {string} equipmentStatus - Status message (e.g., "All equipment in good condition")
 */
async function sendTeamReturnEmail(
  captainEmail,
  captainName,
  teamName,
  sportType,
  equipmentCounts,
  issueDate,
  returnDate,
  equipmentStatus
) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = TEAM_RETURN_TEMPLATE.replace(
      /{{captainName}}/g,
      captainName
    )
      .replace(/{{teamName}}/g, teamName)
      .replace(/{{sportType}}/g, sportType)
      .replace(/{{returnedEquipment}}/g, equipmentList)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{returnDate}}/g, returnDate)
      .replace(/{{equipmentStatus}}/g, equipmentStatus);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: captainEmail,
      subject: `Team Equipment Returned - ${teamName}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Team return email sent to ${captainEmail} (${teamName}) - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send team return email to ${captainEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send team overdue equipment reminder email
 * @param {string} captainEmail - Team captain's email address
 * @param {string} captainName - Team captain's name
 * @param {string} teamName - Team name
 * @param {string} sportType - Sport type
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 * @param {string} issueDate - Original issue date
 * @param {string} returnDate - Expected return date
 * @param {number} daysOverdue - Number of days overdue
 */
async function sendTeamOverdueEmail(
  captainEmail,
  captainName,
  teamName,
  sportType,
  equipmentCounts,
  issueDate,
  returnDate,
  daysOverdue
) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = TEAM_OVERDUE_TEMPLATE.replace(
      /{{captainName}}/g,
      captainName
    )
      .replace(/{{teamName}}/g, teamName)
      .replace(/{{sportType}}/g, sportType)
      .replace(/{{pendingEquipment}}/g, equipmentList)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{returnDate}}/g, returnDate)
      .replace(/{{daysOverdue}}/g, daysOverdue.toString());

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: captainEmail,
      subject: `⚠️ URGENT: Team Equipment Overdue - ${teamName}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Team overdue email sent to ${captainEmail} (${teamName}) - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send team overdue email to ${captainEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

// ========================================================
// AUTOMATED OVERDUE TRACKING (WEBHOOK-BASED)
// ========================================================

// Configuration: Time threshold for marking items overdue (in hours)
const OVERDUE_THRESHOLD_HOURS = parseInt(process.env.OVERDUE_THRESHOLD_HOURS || "6", 10);

/**
 * Automatically check and mark items as overdue
 * Updates database and sends emails for newly overdue items
 * Triggered via webhook endpoint for instant processing
 */
async function checkAndMarkOverdueItems() {
  try {
    logToFile(`🔄 Running automated overdue check (threshold: ${OVERDUE_THRESHOLD_HOURS} hours)...`);

    const now = moment().tz("Asia/Kolkata");
    const currentTime = now.format("YYYY-MM-DD HH:mm:ss");
    
    // Calculate the overdue threshold time (e.g., 6 hours ago)
    const overdueThreshold = now.clone()
      .subtract(OVERDUE_THRESHOLD_HOURS, "hours")
      .format("YYYY-MM-DD HH:mm:ss");

    // Find items that:
    // 1. Are still pending (not returned)
    // 2. Were issued more than OVERDUE_THRESHOLD_HOURS ago
    // 3. Haven't been marked as overdue yet
    const markOverdueQuery = `
      SELECT 
        logID,
        studentID,
        studentName,
        studentEmail,
        equipmentBorrowed,
        timestamp,
        isTeamIssue,
        TIMESTAMPDIFF(HOUR, timestamp, ?) as hoursElapsed
      FROM Logs
      WHERE pending = TRUE 
        AND returned = FALSE
        AND overdue = FALSE
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `;

    const itemsToMarkOverdue = await db.query(markOverdueQuery, [currentTime, overdueThreshold]);

    if (itemsToMarkOverdue.length === 0) {
      logToFile("   ✅ No new items to mark as overdue");
      return { success: true, markedOverdue: 0, emailsSent: 0 };
    }

    logToFile(`   📊 Found ${itemsToMarkOverdue.length} items to mark as overdue`);

    // Update all these items to overdue status
    const logIDs = itemsToMarkOverdue.map(item => item.logID);
    const placeholders = logIDs.map(() => '?').join(',');
    
    await db.query(
      `UPDATE Logs 
       SET overdue = TRUE 
       WHERE logID IN (${placeholders})`,
      logIDs
    );

    logToFile(`   ✅ Marked ${logIDs.length} items as overdue in database`);

    // Group by student for email notifications
    const studentOverdueMap = new Map();
    const teamOverdueMap = new Map();

    itemsToMarkOverdue.forEach((item) => {
      if (item.isTeamIssue) {
        // Team equipment
        if (!teamOverdueMap.has(item.studentID)) {
          teamOverdueMap.set(item.studentID, {
            studentEmail: item.studentEmail,
            studentName: item.studentName,
            equipment: {},
            oldestTimestamp: item.timestamp,
            logIDs: []
          });
        }
        const student = teamOverdueMap.get(item.studentID);
        student.equipment[item.equipmentBorrowed] = (student.equipment[item.equipmentBorrowed] || 0) + 1;
        student.logIDs.push(item.logID);
      } else {
        // Regular equipment
        if (!studentOverdueMap.has(item.studentID)) {
          studentOverdueMap.set(item.studentID, {
            studentEmail: item.studentEmail,
            studentName: item.studentName,
            equipment: {},
            primaryEquipment: item.equipmentBorrowed,
            logIDs: []
          });
        }
        const student = studentOverdueMap.get(item.studentID);
        student.equipment[item.equipmentBorrowed] = (student.equipment[item.equipmentBorrowed] || 0) + 1;
        student.logIDs.push(item.logID);
      }
    });

    let emailsSent = 0;

    // Send emails for regular equipment (one per student)
    for (const [studentID, data] of studentOverdueMap.entries()) {
      // Check if we already sent email for these specific items
      const alreadySent = await db.query(
        `SELECT COUNT(*) as count FROM Logs 
         WHERE logID IN (${data.logIDs.map(() => '?').join(',')}) 
         AND overdueEmailSent = TRUE`,
        data.logIDs
      );

      if (alreadySent[0].count === data.logIDs.length) {
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
        await db.query(
          `UPDATE Logs 
           SET overdueEmailSent = TRUE 
           WHERE logID IN (${data.logIDs.map(() => '?').join(',')})`,
          data.logIDs
        );
        emailsSent++;
        logToFile(`   ✅ Sent overdue notification to ${data.studentName}`);
      }
    }

    // Send emails for team equipment
    for (const [studentID, data] of teamOverdueMap.entries()) {
      // Check if we already sent email for these specific items
      const alreadySent = await db.query(
        `SELECT COUNT(*) as count FROM Logs 
         WHERE logID IN (${data.logIDs.map(() => '?').join(',')}) 
         AND overdueEmailSent = TRUE`,
        data.logIDs
      );

      if (alreadySent[0].count === data.logIDs.length) {
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
        .add(OVERDUE_THRESHOLD_HOURS, "hours")
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
        await db.query(
          `UPDATE Logs 
           SET overdueEmailSent = TRUE 
           WHERE logID IN (${data.logIDs.map(() => '?').join(',')})`,
          data.logIDs
        );
        emailsSent++;
        logToFile(`   ✅ Sent team overdue notification to ${data.studentName}`);
      }
    }

    logToFile(`🏁 Overdue check complete - Marked: ${logIDs.length}, Emails sent: ${emailsSent}`);
    
    return {
      success: true,
      markedOverdue: logIDs.length,
      emailsSent: emailsSent,
      threshold: `${OVERDUE_THRESHOLD_HOURS} hours`
    };
    
  } catch (error) {
    logToFile(`❌ Error in overdue check: ${error.message}`);
    console.error("Overdue check error:", error);
    return { success: false, error: error.message };
  }
}

// ========================================================
// END OVERDUE TRACKING
// ========================================================

// ========================================================
// WEBHOOK FOR AUTOMATED OVERDUE CHECKING
// ========================================================

/**
 * Webhook endpoint to trigger instant overdue checking
 * Automatically marks items overdue after configurable threshold (default: 6 hours)
 * Can be called:
 * - After every borrow/return operation
 * - Via scheduled external service (GitHub Actions, cron services)
 * - Manually by admins for testing
 */
app.post("/api/check-overdue", async (req, res) => {
  try {
    // Optional: Add API key authentication for security
    const apiKey = req.headers["x-api-key"] || req.body.apiKey;
    const expectedKey = process.env.WEBHOOK_API_KEY;
    
    if (expectedKey && apiKey !== expectedKey) {
      logToFile("⚠️ Unauthorized overdue check attempt");
      return res.status(401).json({ 
        success: false, 
        error: "Unauthorized - Invalid API key" 
      });
    }

    logToFile("🔔 Webhook triggered: Starting automated overdue check");
    
    // Run the automated overdue check
    const result = await checkAndMarkOverdueItems();
    
    res.json({ 
      success: result.success,
      message: "Automated overdue check completed",
      timestamp: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      data: {
        itemsMarkedOverdue: result.markedOverdue || 0,
        emailsSent: result.emailsSent || 0,
        overdueThreshold: result.threshold || `${OVERDUE_THRESHOLD_HOURS} hours`
      }
    });
  } catch (error) {
    logToFile(`❌ Webhook error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * GET endpoint for manual/browser-based triggering (admin use)
 */
app.get("/api/check-overdue", async (req, res) => {
  try {
    // Require admin authentication for GET endpoint
    if (!req.isAuthenticated() || req.user?.role !== "admin") {
      return res.status(403).json({ 
        success: false, 
        error: "Admin access required" 
      });
    }

    logToFile("🔔 Manual overdue check triggered by admin");
    const result = await checkAndMarkOverdueItems();
    
    res.json({ 
      success: result.success,
      message: "Manual overdue check completed",
      timestamp: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      data: {
        itemsMarkedOverdue: result.markedOverdue || 0,
        emailsSent: result.emailsSent || 0,
        overdueThreshold: result.threshold || `${OVERDUE_THRESHOLD_HOURS} hours`
      }
    });
  } catch (error) {
    logToFile(`❌ Manual overdue check error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================================
// END WEBHOOK
// ========================================================

/**
 * Helper function to automatically trigger overdue check
 * Call this after equipment borrow/return operations
 * Runs asynchronously without blocking the main operation
 */
async function autoTriggerOverdueCheck() {
  try {
    // Don't await - fire and forget to avoid blocking
    setImmediate(async () => {
      try {
        logToFile("🔄 Auto-triggering overdue check after equipment operation...");
        await checkAndMarkOverdueItems();
      } catch (error) {
        logToFile(`⚠️ Auto-trigger overdue check failed: ${error.message}`);
      }
    });
  } catch (error) {
    // Silently fail - don't break the main operation
    console.error("Error scheduling auto overdue check:", error);
  }
}

app.use(
  session({
    name: "mailroom_sid",
    secret: process.env.SECRET_KEY || "your_session_secret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Global authentication middleware
app.use((req, res, next) => {
  // ================= PUBLIC / API / FETCH ROUTES =================
  if (
    // ---------- Auth & landing ----------
    req.path.startsWith("/auth") ||
    req.path === "/" ||
    req.path === "/logout" ||
    req.path === "/unauthorized" ||
    // ---------- Static assets ----------
    req.path.startsWith("/style") ||
    req.path.startsWith("/images") ||
    // ---------- FETCH / API routes ----------
    req.path === "/getequipment" ||
    req.path === "/get_offences" ||
    req.path === "/sports_request" ||
    req.path === "/update_inventory" ||
    req.path === "/delete_inventory" ||
    req.path === "/returnMany" ||
    req.path === "/issue_team_equipment" ||
    req.path === "/return_team_equipment" ||
    req.path === "/api/check-overdue" || // Webhook endpoint
    req.path === "/api/statistics" || // Statistics API endpoint
    // Allow if user has student session OR is OAuth authenticated
    if (req.session.student || req.isAuthenticated()) {
      return next();
    }
    // Redirect to appropriate login page
    if (req.path === "/issue") {
      return res.redirect("/issue_login");
    }
    return res.redirect("/return_login");
  }

  // HARD BLOCK: team issue / return must use QR ONLY
  const qrOnlyPaths = [
    "/issue_team",
    "/team_return",
    "/issue_team_equipment",
    "/return_team_equipment",
  ];

  if (qrOnlyPaths.includes(req.path)) {
    if (!req.session.student) {
      return res.redirect(
        req.path.startsWith("/team_return")
          ? "/team_return_login"
          : "/issue_team_login"
      );
    }
    return next();
  }

  // Default: redirect to issue login
  res.redirect("/issue_login");
});

function viewUser(req) {
  return {
    user: req.user?.name || "",
    isAuthenticated: req.isAuthenticated(),
    isAdmin: req.user?.role === "admin",
  };
}

function requireStudent(req, res, next) {
  if (req.session.student) {
    return next();
  }

  // Return-side pages
  const returnPages = ["/landing"];

  if (returnPages.includes(req.path)) {
    return res.redirect("/return_login");
  }

  // Issue-side pages
  return res.redirect("/issue_login");
}
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user?.role === "admin") {
    return next();
  }
  // Handle API requests with JSON response
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ 
      error: "Forbidden: Admin access only" 
    });
  }
  // Handle page requests with HTML error page
  return res.status(403).render("error", {
    msg: "Forbidden: Admin access only",
  });
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/google");
}

app.set("views", path.join(__dirname, "../views"));
app.set("view engine", "ejs");

// Fix students.json path
const students = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../students.json"), "utf-8")
);

app.get(
  "/auth/google",
  (req, res, next) => {
    const returnTo = req.session.returnTo; // save it

    req.session.regenerate((err) => {
      if (err) return next(err);

      if (returnTo) {
        req.session.returnTo = returnTo; // restore it
      }

      next();
    });
  },
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/unauthorized",
    failureMessage: true,
  }),
  (req, res) => {
    if (req.session.messages) {
      console.error("Authentication failure:", req.session.messages);
    }

    const returnTo = req.session.returnTo || "/issue_login";
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);

    req.session.regenerate(() => {
      res.clearCookie("mailroom_sid");
      res.redirect("/auth/google");
    });
  });
});

app.get("/unauthorized", (req, res) => {
  res.render("error", {
    msg: "Unauthorized: Your email is not authorized to access this system.",
  });
});

const BASE_URL = process.env.BASE_URL;

app.get("/", (req, res) => {
  res.render("issue_login", {
    activePage: "issue",
    ...viewUser(req),
  });
});

app.get("/issue_login", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/auth/google");
  }
  res.render("issue_login", {
    activePage: "issue",
    ...viewUser(req),
  });
});

app.post("/issue_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  const studentData = students.find(
    (s) => String(s.AshokaId).trim() === ashokaId
  );

  if (!studentData) return res.status(404).send("Student not found");
  console.log("Student Data:", studentData);
  req.session.student = studentData;
  res.redirect("/issue");
});

app.post("/issue_login_sports", (req, res) => {
  const ashokaId = req.body.qrString?.trim();

  db.query(
    "SELECT sportsTeamAuthorised FROM Students WHERE studentID = ?",
    [ashokaId],
    (err, results) => {
      if (err) return res.status(500).send("Database error");
      if (results.length === 0)
        return res.status(404).send("Student not found");

      if (!results[0].sportsTeamAuthorised) {
        return res.render("error", {
          msg: "Unauthorized: You are not authorised as a sports team member.",
        });
      }

      req.session.student = { AshokaId: ashokaId };

      req.session.save(() => {
        res.redirect("/issue_team");
      });
    }
  );
});

function calculateAvailableEquipment(callback) {
  const query = `
    SELECT 
      e.equipment,
      e.totalQuantity,
      e.inUseQuantity,
      COALESCE(COUNT(l.logID), 0) as pendingCount
    FROM Equipment e
    LEFT JOIN Logs l ON e.equipment = l.equipmentBorrowed AND l.pending = TRUE
    GROUP BY e.equipment, e.totalQuantity, e.inUseQuantity
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return callback(err, null);
    }

    const availableItems = {};
    results.forEach((row) => {
      // Available = Total - InUse - Pending
      availableItems[row.equipment] =
        row.totalQuantity - row.inUseQuantity - row.pendingCount;
    });

    callback(null, availableItems);
  });
}

function getInUseEquipment(callback) {
  // select inUseQuantity from table Equipment
  const query = `
    SELECT 
      equipment,
      inUseQuantity as inUseCount
      from Equipment
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return callback(err, null);
    }

    const inUseItems = {};
    results.forEach((row) => {
      inUseItems[row.equipment] = row.inUseCount;
    });

    callback(null, inUseItems);
  });
}
// ================= TEAM ISSUE QR LOGIN =================
app.get("/issue_team_login", (req, res) => {
  req.session.student = null; // FORCE fresh QR
  res.render("issue_login", {
    activePage: "team-landing",
    viewUser: viewUser(req),
  });
});

// Sports team issue endpoint
app.get(
  "/issue_team",
  (req, res, next) => {
    if (!req.session.student) {
      return res.redirect("/issue_team_login");
    }
    next();
  },
  (req, res) => {
    getInUseEquipment((err, totalItems) => {
      if (err) {
        return res.status(500).send("Error calculating in use equipment");
      }

      // get the email by querying the Students table on AshokaId
      db.query(
        "SELECT studentEmail FROM Students WHERE studentID = ?",
        [req.session.student.AshokaId],
        (emailErr, emailResults) => {
          if (emailErr || emailResults.length === 0) {
            console.error("Error fetching student email:", emailErr);
            return res.status(500).send("Could not find student email");
          }

          const studentEmail = emailResults[0].studentEmail;
          const studentName = req.session.student.name;
          const currentDate = new Date().toISOString().split("T")[0];

          console.log(
            "Querying with information: ",
            studentEmail,
            studentName,
            currentDate
          );

          // Check for valid sports request
          db.query(
            `SELECT equipment, quantity, startDate, endDate, approvedOn 
           FROM SportsRequests 
           WHERE studentEmail = ? 
           AND studentName = ? 
           AND startDate <= ? 
           AND endDate >= ? 
           AND (issued IS NULL OR issued = FALSE)`,
            [studentEmail, studentName, currentDate, currentDate],
            (err, results) => {
              if (err) {
                console.error("Database error:", err);
                return res.status(500).send("Database error");
              }

              if (results.length === 0) {
                return res.render("error", {
                  errorMsg:
                    "No valid sports equipment request found for your account. Please use the regular issue portal.",
                  ...viewUser(req),
                });
              }

              // Transform results to match the frontend's expected format
              const equipment = results.map((item) => ({
                equipment: item.equipment,
                outNum: item.quantity,
                outTime: item.approvedOn || new Date().toISOString(),
              }));

              // Render the team issue page
              res.render("team_issue", {
                student: req.session.student,
                equipment: equipment,
                activePage: "team-landing",
                ...viewUser(req),
              });
            }
          );
        }
      );
    });
  }
);

app.get("/team_return_login", (req, res) => {
  req.session.student = null; // force fresh QR

  res.render("team_return_login", {
    activePage: "team-return",
    ...viewUser(req),
  });
});

app.get("/team_return", async (req, res) => {
  if (!req.session.student) {
    return res.redirect("/team_return_login");
  }

  const student = req.session.student;

  try {
    const rows = await db.query(
      `
      SELECT
        equipmentBorrowed AS equipment,
        COUNT(*) AS outNum,
        MIN(timestamp) AS outTime
      FROM Logs
      WHERE studentID = ?
        AND isTeamIssue = TRUE
        AND pending = TRUE
        AND returned = FALSE
      GROUP BY equipmentBorrowed
      `,
      [student.AshokaId]
    );

    const equipment = rows.map((row) => ({
      equipment: row.equipment,
      outNum: row.outNum,
      outTime: moment(row.outTime)
        .tz("Asia/Kolkata")
        .format("ddd DD-MM-YYYY HH:mm:ss"),
    }));

    res.render("team_return", {
      student,
      equipment,
      activePage: "team-return",
      ...viewUser(req),
    });
  } catch (err) {
    console.error("Error loading team return page:", err);
    res.status(500).send("Failed to load team return page");
  }
});

app.post("/team_return_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim();

  const studentData = students.find(
    (s) => String(s.AshokaId).trim() === ashokaId
  );

  if (!studentData) {
    return res.status(404).send("Student not found");
  }

  req.session.student = studentData;
  res.redirect("/team_return");
});

app.post("/return_team_equipment", requireStudent, async (req, res) => {
  const equipments =
    typeof req.body.equipments === "string"
      ? JSON.parse(req.body.equipments)
      : req.body.equipments;

  const studentId = req.session.student.AshokaId;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  if (!equipments || equipments.length === 0) {
    return res.json({ success: false, error: "No equipment provided" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const returnedCounts = {};

    // 1. Mark Logs as returned
    for (const item of equipments) {
      const { equipment, outNum } = item;
      returnedCounts[equipment] =
        (returnedCounts[equipment] || 0) + Number(outNum);

      const [logs] = await connection.query(
        `
        SELECT logID
        FROM Logs
        WHERE studentID = ?
          AND equipmentBorrowed = ?
          AND isTeamIssue = TRUE
          AND pending = TRUE
          AND returned = FALSE
        LIMIT ?
        `,
        [studentId, equipment, outNum]
      );

      if (logs.length < outNum) {
        throw new Error(`Not enough team-issued ${equipment} found to return`);
      }

      for (const log of logs) {
        await connection.query(
          `
          UPDATE Logs
          SET pending = FALSE,
              returned = TRUE,
              returnedTimestamp = ?
          WHERE logID = ?
          `,
          [returnTime, log.logID]
        );
      }
    }

    // 2. Update Equipment inventory
    for (const [equipment, qty] of Object.entries(returnedCounts)) {
      const [result] = await connection.query(
        `
        UPDATE Equipment
        SET reservedQuantity = GREATEST(reservedQuantity - ?, 0),
            inUseQuantity = inUseQuantity + ?
        WHERE equipment = ?
        `,
        [qty, qty, equipment]
      );

      if (result.affectedRows === 0) {
        throw new Error(
          `Equipment "${equipment}" not found while updating inventory`
        );
      }
    }

    // 3. Sync SportsRequests.returned
    for (const equipment of Object.keys(returnedCounts)) {
      const [[issuedRow]] = await connection.query(
        `
        SELECT COUNT(*) AS totalIssued
        FROM Logs
        WHERE studentID = ?
          AND equipmentBorrowed = ?
          AND isTeamIssue = TRUE
        `,
        [studentId, equipment]
      );

      const [[returnedRow]] = await connection.query(
        `
        SELECT COUNT(*) AS totalReturned
        FROM Logs
        WHERE studentID = ?
          AND equipmentBorrowed = ?
          AND isTeamIssue = TRUE
          AND returned = TRUE
        `,
        [studentId, equipment]
      );

      if (issuedRow.totalIssued === returnedRow.totalReturned) {
        await connection.query(
          `
          UPDATE SportsRequests
          SET returned = TRUE
          WHERE equipment = ?
            AND issued = TRUE
            AND studentEmail = (
              SELECT studentEmail FROM Students WHERE studentID = ?
            )
          `,
          [equipment, studentId]
        );
      }
    }

    await connection.commit();

    // Send team return confirmation email
    const student = req.session.student;

    // Get student email
    const emailRows = await db.query(
      "SELECT studentEmail FROM Students WHERE studentID = ?",
      [studentId]
    );

    if (emailRows.length > 0) {
      const studentEmail = emailRows[0].studentEmail;
      const returnDate = moment().tz("Asia/Kolkata").format("MMMM D, YYYY");

      // Get the original issue date from the first log
      const issueLogs = await db.query(
        `SELECT timestamp FROM Logs 
         WHERE studentID = ? AND isTeamIssue = TRUE 
         ORDER BY timestamp ASC LIMIT 1`,
        [studentId]
      );

      const issueDate =
        issueLogs.length > 0
          ? moment(issueLogs[0].timestamp)
              .tz("Asia/Kolkata")
              .format("MMMM D, YYYY")
          : "N/A";

      const teamName = "Sports Team"; // You may want to add this to the request
      const sportType = Object.keys(returnedCounts).join(", ");
      const equipmentStatus = "All equipment returned successfully";

      await sendTeamReturnEmail(
        studentEmail,
        student.name,
        teamName,
        sportType,
        returnedCounts,
        issueDate,
        returnDate,
        equipmentStatus
      );
    }

    res.render("success", {
      ...viewUser(req),
      studentName: student.name,
      mode: "returned",
      equipment: Object.entries(returnedCounts).map(([equipment, outNum]) => ({
        equipment,
        outNum,
      })),
    });
  } catch (err) {
    await connection.rollback();
    console.error("Team return error:", err);
    res.json({ success: false, error: err.message });
  } finally {
    connection.release();
  }
});

// Regular issue endpoint - GET
app.get("/issue", (req, res) => {
  // Calculate actual available equipment by checking pending logs
  db.query(
    `SELECT 
      e.equipment,
      e.inUseQuantity,
      COALESCE(COUNT(l.logID), 0) as pendingCount,
      (e.inUseQuantity - COALESCE(COUNT(l.logID), 0)) as available
    FROM Equipment e
    LEFT JOIN Logs l ON e.equipment = l.equipmentBorrowed AND l.pending = TRUE
    GROUP BY e.equipment, e.inUseQuantity`,
    (err, results) => {
      if (err) {
        console.error("Error calculating equipment availability:", err);
        return res.status(500).send("Error calculating equipment");
      }

      // Transform results into a more usable format
      const availableItems = {};
      results.forEach((row) => {
        availableItems[row.equipment] = row.available;
      });

      res.render("issue", {
        student: req.session.student,
        availableItems: availableItems,
        activePage: "issue",
        ...viewUser(req),
      });
    }
  );
});

// Regular issue endpoint - POST
app.post("/issue", (req, res) => {
  const currentTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const quantity = req.body.quantity || {};

  // Get list of equipment to issue (where quantity > 0)
  const equipmentList = Object.keys(quantity).filter(
    (item) => Number(quantity[item]) > 0
  );

  if (equipmentList.length === 0) {
    return res.redirect("/landing");
  }

  // First, get the student email from the Students table
  db.query(
    "SELECT studentEmail FROM Students WHERE studentID = ?",
    [req.session.student.AshokaId],
    (emailErr, emailResults) => {
      if (emailErr || emailResults.length === 0) {
        console.error("Error fetching student email:", emailErr);
        return res.status(500).send("Could not find student email");
      }

      const studentEmail = emailResults[0].studentEmail;

      // Double-check availability before proceeding (race condition protection)
      const placeholders = equipmentList.map(() => "?").join(",");

      db.query(
        `SELECT 
          e.equipment,
          e.inUseQuantity,
          COALESCE(COUNT(l.logID), 0) as pendingCount,
          (e.inUseQuantity - COALESCE(COUNT(l.logID), 0)) as available
        FROM Equipment e
        LEFT JOIN Logs l ON e.equipment = l.equipmentBorrowed AND l.pending = TRUE
        WHERE e.equipment IN (${placeholders})
        GROUP BY e.equipment, e.inUseQuantity`,
        equipmentList,
        (availErr, availResults) => {
          if (availErr) {
            console.error("Error checking availability:", availErr);
            return res.status(500).send("Database error");
          }

          // Check if requested quantities are available
          const availabilityMap = {};
          availResults.forEach((row) => {
            availabilityMap[row.equipment] = row.available;
          });

          for (let item of equipmentList) {
            const requested = Number(quantity[item]);
            const available = availabilityMap[item] || 0;

            if (requested > available) {
              return res
                .status(400)
                .send(
                  `Not enough ${item} available. Requested: ${requested}, Available: ${available}`
                );
            }
          }

          // Proceed with issuing equipment
          let completed = 0;
          let hasError = false;
          const issuedEquipment = [];

          equipmentList.forEach((item) => {
            const qtyToIssue = Number(quantity[item]);

            // Calculate due date (e.g., 7 days from now)
            const dueDate = moment()
              .tz("Asia/Kolkata")
              .add(7, "days")
              .format("YYYY-MM-DD HH:mm:ss");

            // Insert one row per unit of equipment (repeat for quantity)
            for (let i = 0; i < qtyToIssue; i++) {
              db.query(
                `INSERT INTO Logs (
                  timestamp, 
                  equipmentBorrowed, 
                  studentID, 
                  studentEmail, 
                  studentName, 
                  dueOn, 
                  pending, 
                  returned
                ) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE)`,
                [
                  currentTime,
                  item,
                  req.session.student.AshokaId,
                  studentEmail,
                  req.session.student.name,
                  dueDate,
                ],
                (insertErr) => {
                  if (insertErr) {
                    hasError = true;
                    console.error("Error issuing equipment:", insertErr);
                  }

                  completed++;

                  // Check if all insertions are complete
                  const totalInsertions = equipmentList.reduce(
                    (sum, eq) => sum + Number(quantity[eq]),
                    0
                  );

                  if (completed === totalInsertions) {
                    if (hasError) {
                      return res.status(500).send("Database error");
                    }

                    // Build issued equipment list (grouped by equipment type)
                    equipmentList.forEach((eq) => {
                      issuedEquipment.push({
                        equipment: eq,
                        outNum: Number(quantity[eq]),
                      });
                    });

                    // Prepare equipment counts for email
                    const equipmentCounts = {};
                    equipmentList.forEach((eq) => {
                      equipmentCounts[eq] = Number(quantity[eq]);
                    });

                    // Send borrow confirmation email (non-blocking)
                    sendBorrowEmail(
                      studentEmail,
                      req.session.student.name,
                      equipmentCounts
                    ).catch((err) => {
                      console.error("Email send error:", err);
                      // Don't block the response on email failure
                    });

                    // Auto-trigger overdue check after successful borrow
                    autoTriggerOverdueCheck();

                    // Render success page with equipment details
                    res.render("success", {
                      studentName: req.session.student.name,
                      equipment: issuedEquipment,
                      ...viewUser(req),
                      mode: "issued",
                    });
                  }
                }
              );
            }
          });
        }
      );
    }
  );
});

app.post("/issue_team_equipment", requireStudent, async (req, res) => {
  const selectedEquipments =
    typeof req.body.equipments === "string"
      ? JSON.parse(req.body.equipments)
      : req.body.equipments;

  const student = req.session.student;

  if (!selectedEquipments || selectedEquipments.length === 0) {
    return res.json({ success: false, error: "No equipment selected" });
  }

  const currentTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const dueDate = moment()
    .tz("Asia/Kolkata")
    .add(7, "days")
    .format("YYYY-MM-DD HH:mm:ss");

  try {
    // Fetch student email
    const emailRows = await db.query(
      "SELECT studentEmail FROM Students WHERE studentID = ?",
      [student.AshokaId]
    );

    if (emailRows.length === 0) {
      return res
        .status(500)
        .json({ success: false, error: "Student email not found" });
    }

    const studentEmail = emailRows[0].studentEmail;

    // Fetch approved sports requests
    const placeholders = selectedEquipments.map(() => "?").join(",");

    const requests = await db.query(
      `SELECT equipment, quantity
       FROM SportsRequests
       WHERE studentEmail = ?
         AND studentName = ?
         AND equipment IN (${placeholders})
         AND (issued IS NULL OR issued = FALSE)`,
      [studentEmail, student.name, ...selectedEquipments]
    );

    if (requests.length === 0) {
      return res.json({ success: false, error: "No valid requests found" });
    }

    // Insert into Logs item-wise (same as normal issue)
    for (const reqItem of requests) {
      for (let i = 0; i < reqItem.quantity; i++) {
        await db.query(
          `INSERT INTO Logs (
              timestamp,
              equipmentBorrowed,
              studentID,
              studentEmail,
              studentName,
              dueOn,
              pending,
              returned,
              isTeamIssue
            ) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE, TRUE)
            `,
          [
            currentTime,
            reqItem.equipment,
            student.AshokaId,
            studentEmail,
            student.name,
            dueDate,
          ]
        );
      }
    }

    // Mark sports requests as issued
    await db.query(
      `UPDATE SportsRequests
       SET issued = TRUE
       WHERE studentEmail = ?
         AND studentName = ?
         AND equipment IN (${placeholders})
         AND (issued IS NULL OR issued = FALSE)`,
      [studentEmail, student.name, ...selectedEquipments]
    );

    // Send team borrow confirmation email
    const equipmentCounts = {};
    requests.forEach((reqItem) => {
      equipmentCounts[reqItem.equipment] = reqItem.quantity;
    });

    const issueDate = moment().tz("Asia/Kolkata").format("MMMM D, YYYY");
    const returnDate = moment()
      .tz("Asia/Kolkata")
      .add(7, "days")
      .format("MMMM D, YYYY");

    // Determine team name and sport type from equipment
    const teamName = "Sports Team"; // You may want to add this to the request
    const sportType = selectedEquipments.join(", ");

    await sendTeamBorrowEmail(
      studentEmail,
      student.name,
      teamName,
      sportType,
      equipmentCounts,
      issueDate,
      returnDate
    );

    // Auto-trigger overdue check after successful team borrow
    autoTriggerOverdueCheck();

    res.render("success", {
      ...viewUser(req),
      studentName: student.name,
      mode: "issued",
      equipment: Object.entries(equipmentCounts).map(([equipment, outNum]) => ({
        equipment,
        outNum,
      })),
    });
  } catch (err) {
    console.error("Team issue error:", err);
    res.status(500).json({ success: false, error: "Team issue failed" });
  }
});

app.get("/return_login", (req, res) => {
  res.render("return_login", {
    activePage: "landing",
    ...viewUser(req),
  });
});

app.post("/return_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  const studentData = students.find(
    (s) => String(s.AshokaId).trim() === ashokaId
  );

  if (!studentData) return res.status(404).send("Student not found");

  req.session.student = studentData;
  res.redirect("/landing");
});

app.get("/landing", (req, res) => {
  if (!req.session.student) {
    return res.redirect("/return_login");
  }
  res.render("landing_redirect", {
    ashokaId: req.session.student.AshokaId,
    activePage: "landing",
    ...viewUser(req),
  });
});

app.post("/landing", async (req, res) => {
  const ashokaId = String(req.body.qrString).trim();
  const studentData = students.find((student) => {
    return String(student.AshokaId).trim() === String(ashokaId).trim();
  });

  if (!studentData) {
    return res.status(404).send("Student not found");
  }
  req.session.student = studentData;

  db.query(
    `SELECT 
      logID,
      studentID, 
      studentName, 
      equipmentBorrowed as equipment, 
      timestamp as outTime, 
      dueOn,
      pending, 
      returned,
      returnedTimestamp as inTime
    FROM Logs 
    WHERE studentID = ? AND pending = TRUE AND returned = FALSE AND isTeamIssue = FALSE`,
    [ashokaId],
    (err, results) => {
      if (err) return res.status(500).send("Database error");

      results.forEach((r) => {
        r.outTime = moment(r.outTime)
          .tz("Asia/Kolkata")
          .format("ddd DD-MM-YYYY HH:mm:ss");
        r.dueOn = moment(r.dueOn)
          .tz("Asia/Kolkata")
          .format("ddd DD-MM-YYYY HH:mm:ss");
      });

      res.render("landing", {
        student: studentData,
        equipment: results,
        ...viewUser(req),
      });
    }
  );
});

// Return equipment rows including inUseQuantity so clients can filter
app.get("/getequipment", (req, res) => {
  db.query("SELECT equipment, inUseQuantity FROM Equipment", (err, rows) => {
    if (err) {
      console.error("Database error fetching equipment:", err);
      return res.status(500).json([]);
    }

    // rows is an array of { equipment, inUseQuantity }
    res.json(rows);
  });
});

app.post("/returnMany", async (req, res) => {
  if (!req.session.student) {
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  const { returns } = req.body;
  const studentId = req.session.student.AshokaId;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  if (!returns || returns.length === 0) {
    return res.json({ success: false, error: "No items selected" });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Track only DAMAGED items for inventory changes
    const damagedUpdates = {};
    const returnedItems = {};

    for (const returnItem of returns) {
      const { logID, equipment, damaged } = returnItem;

      // Ensure log is valid and pending
      const [logRows] = await connection.query(
        `SELECT logID, isTeamIssue FROM Logs
          WHERE logID = ?
            AND studentID = ?
            AND pending = TRUE
            AND returned = FALSE`,
        [logID, studentId]
      );
      if (logRows[0].isTeamIssue) {
        await connection.rollback();
        return res.json({
          success: false,
          error: "Team-issued equipment cannot be returned via this route",
        });
      }
      if (logRows.length === 0) {
        await connection.rollback();
        return res.json({
          success: false,
          error: `Log entry ${logID} not found or already returned`,
        });
      }

      // Mark log as returned
      await connection.query(
        `UPDATE Logs
         SET pending = FALSE,
             returned = TRUE,
             returnedTimestamp = ?,
             returnedByID = NULL,
             returnedByEmail = NULL,
             damaged = ?
         WHERE logID = ?`,
        [returnTime, damaged ? "Yes" : "No", logID]
      );

      // Only damaged items affect inventory counts
      if (damaged) {
        damagedUpdates[equipment] = (damagedUpdates[equipment] || 0) + 1;
      }

      // Track for email
      returnedItems[equipment] = (returnedItems[equipment] || 0) + 1;
    }

    // Reduce usable stock for damaged items
    const damagedInventoryPromises = Object.keys(damagedUpdates).map(
      async (equipment) => {
        const qty = damagedUpdates[equipment];

        const [result] = await connection.query(
          `UPDATE Equipment
           SET inUseQuantity = inUseQuantity - ?,
               damagedQuantity = damagedQuantity + ?
           WHERE equipment = ?`,
          [qty, qty, equipment]
        );

        if (result.affectedRows === 0) {
          throw new Error(
            `Equipment "${equipment}" not found during damaged update`
          );
        }
      }
    );

    await Promise.all(damagedInventoryPromises);
    await connection.commit();

    // Send return confirmation email (non-blocking)
    try {
      const emailResults = await db.query(
        "SELECT studentEmail, studentName FROM Students WHERE studentID = ?",
        [studentId]
      );

      if (emailResults.length > 0) {
        const { studentEmail, studentName } = emailResults[0];
        sendReturnEmail(studentEmail, studentName, returnedItems).catch(
          () => {}
        );
      }
    } catch (_) {}

    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error("Error returning equipment:", err);
    res.json({
      success: false,
      error: "Failed to return equipment: " + err.message,
    });
  } finally {
    connection.release();
  }
});

app.post("/sports_request", (req, res) => {
  const {
    studentEmail,
    studentName,
    team,
    equipment,
    quantity,
    startDate,
    endDate,
  } = req.body;

  // Validation
  if (
    !studentEmail ||
    !studentName ||
    !team ||
    !equipment ||
    !quantity ||
    !endDate
  ) {
    return res.status(400).json({
      success: false,
      message: "All fields are required.",
    });
  }

  if (quantity <= 0) {
    return res.status(400).json({
      success: false,
      message: "Quantity must be a positive number.",
    });
  }

  const query = `
    INSERT INTO SportsRequests
    (studentEmail, studentName,team, equipment, quantity, startDate, endDate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [studentEmail, studentName, team, equipment, quantity, startDate, endDate],
    (err, result) => {
      if (err) {
        console.error("Error inserting sports request:", err);
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      // After inserting the sports request, update Equipment counts:
      // subtract approved quantity from inUseQuantity and add to reservedQuantity
      const updQuery = `
        UPDATE Equipment
        SET inUseQuantity = GREATEST(inUseQuantity - ?, 0),
            reservedQuantity = reservedQuantity + ?
        WHERE equipment = ?
      `;

      db.query(updQuery, [quantity, quantity, equipment], (updErr, updRes) => {
        if (updErr) {
          console.error(
            "Error updating Equipment after sports request:",
            updErr
          );
          return res.status(500).json({
            success: false,
            error:
              "Request saved but failed to update inventory: " + updErr.message,
            requestId: result.insertId,
          });
        }

        return res.status(201).json({
          success: true,
          message: "Sports request submitted successfully",
          requestId: result.insertId,
        });
      });
    }
  );
});

app.post("/update_inventory", (req, res) => {
  const inventory = req.body.inventory;

  for (const item of inventory) {
    if (!item.equipment || item.equipment.trim() === "") {
      return res.status(400).json({ error: `Equipment name cannot be empty.` });
    }

    const { reservedQuantity, damagedQuantity, inUseQuantity } = item;

    const nums = [reservedQuantity, damagedQuantity, inUseQuantity];
    if (nums.some((n) => Number.isNaN(n) || n < 0)) {
      return res
        .status(400)
        .json({ error: `Quantities must be non-negative numbers.` });
    }

    item.totalQuantity = reservedQuantity + damagedQuantity + inUseQuantity;
  }

  let completed = 0;

  inventory.forEach((item) => {
    // If originalEquipment is provided and different, attempt a targeted UPDATE (handles renames)
    if (item.originalEquipment && item.originalEquipment !== item.equipment) {
      db.query(
        `UPDATE Equipment SET
           equipment = ?,
           totalQuantity = ?,
           reservedQuantity = ?,
           damagedQuantity = ?,
           inUseQuantity = ?
         WHERE equipment = ?`,
        [
          item.equipment,
          item.totalQuantity,
          item.reservedQuantity,
          item.damagedQuantity,
          item.inUseQuantity,
          item.originalEquipment,
        ],
        (err, result) => {
          if (err) {
            console.error("Update error:", err);
            return res.status(500).json({ error: "Database update failed." });
          }

          // If no rows were affected, fall back to insert (new equipment)
          if (result.affectedRows === 0) {
            db.query(
              `INSERT INTO Equipment (equipment, totalQuantity, reservedQuantity, damagedQuantity, inUseQuantity)
               VALUES (?, ?, ?, ?, ?)`,
              [
                item.equipment,
                item.totalQuantity,
                item.reservedQuantity,
                item.damagedQuantity,
                item.inUseQuantity,
              ],
              (insErr) => {
                if (insErr) {
                  console.error("Insert fallback error:", insErr);
                  return res
                    .status(500)
                    .json({ error: "Database insert failed." });
                }

                completed++;
                if (completed === inventory.length) {
                  return res.json({
                    message: "Inventory updated successfully",
                  });
                }
              }
            );
            return;
          }

          completed++;
          if (completed === inventory.length) {
            return res.json({ message: "Inventory updated successfully" });
          }
        }
      );
    } else {
      // No rename: insert or update by unique key
      db.query(
        `INSERT INTO Equipment (equipment, totalQuantity, reservedQuantity, damagedQuantity, inUseQuantity)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           totalQuantity = VALUES(totalQuantity),
           reservedQuantity = VALUES(reservedQuantity),
           damagedQuantity = VALUES(damagedQuantity),
           inUseQuantity = VALUES(inUseQuantity)`,
        [
          item.equipment,
          item.totalQuantity,
          item.reservedQuantity,
          item.damagedQuantity,
          item.inUseQuantity,
        ],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database update failed." });
          }

          completed++;
          if (completed === inventory.length) {
            return res.json({ message: "Inventory updated successfully" });
          }
        }
      );
    }
  });
});

// Delete inventory item by equipment name
app.post("/delete_inventory", (req, res) => {
  const equipment = req.body.equipment;

  if (!equipment || equipment.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Equipment name required",
    });
  }

  // Instead of deleting, zero out quantities
  db.query(
    `UPDATE Equipment
     SET totalQuantity = 0,
         reservedQuantity = 0,
         damagedQuantity = 0,
         inUseQuantity = 0
     WHERE equipment = ?`,
    [equipment],
    (err, result) => {
      if (err) {
        console.error("Error zeroing equipment:", err);
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: "Equipment not found",
        });
      }

      return res.json({
        success: true,
        message: "Equipment inventory cleared successfully",
      });
    }
  );
});
app.get("/get_offences", ensureAuthenticated, (req, res) => {
  db.query(
    `
    SELECT studentName, studentEmail, offences
    FROM Students
    WHERE offences > 0
    ORDER BY offences DESC
    `,
    (err, results) => {
      if (err) {
        console.error("Error fetching offences:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(results);
    }
  );
});

app.get("/team_landing", (req, res) => {
  res.render("team_landing", {
    activePage: "team-landing",
    ...viewUser(req),
  });
});

app.get("/admin", ensureAdmin, (req, res) => {
  db.query("SELECT * FROM Equipment", (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send("Database error");
    }

    const equipmentData = results.map((row) => ({
      equipment: row.equipment,
      totalQuantity: row.totalQuantity,
      reservedQuantity: row.reservedQuantity,
      damagedQuantity: row.damagedQuantity,
      inUseQuantity: row.inUseQuantity,
    }));

    console.log("Equipment Data:", equipmentData);

    res.render("admin", {
      activePage: "admin",
      ...viewUser(req),
      equipment: equipmentData,
    });
  });
});

// API endpoint for statistics data
app.get("/api/statistics", ensureAdmin, async (req, res) => {
  try {
    const period = req.query.period || "today";
    
    // Determine date filter based on period
    let dateFilter = "";
    let returnDateFilter = "";
    const now = moment().tz("Asia/Kolkata");
    
    switch (period) {
      case "today":
        dateFilter = `AND DATE(timestamp) = '${now.format("YYYY-MM-DD")}'`;
        returnDateFilter = `AND DATE(returnedTimestamp) = '${now.format("YYYY-MM-DD")}'`;
        break;
      case "week":
        const weekStart = now.clone().startOf("week").format("YYYY-MM-DD");
        dateFilter = `AND DATE(timestamp) >= '${weekStart}'`;
        returnDateFilter = `AND DATE(returnedTimestamp) >= '${weekStart}'`;
        break;
      case "month":
        const monthStart = now.clone().startOf("month").format("YYYY-MM-DD");
        dateFilter = `AND DATE(timestamp) >= '${monthStart}'`;
        returnDateFilter = `AND DATE(returnedTimestamp) >= '${monthStart}'`;
        break;
      case "all":
      default:
        dateFilter = "";
        returnDateFilter = "";
        break;
    }

    console.log(`[Statistics] Fetching data for period: ${period}`);

    // Total checkouts
    const totalCheckouts = await db.query(
      `SELECT COUNT(*) as count FROM Logs WHERE 1=1 ${dateFilter}`
    );

    // Total returns
    const totalReturns = await db.query(
      `SELECT COUNT(*) as count FROM Logs WHERE returned = TRUE ${returnDateFilter}`
    );

    // Active users (unique borrowers)
    const activeUsers = await db.query(
      `SELECT COUNT(DISTINCT studentID) as count FROM Logs WHERE 1=1 ${dateFilter}`
    );

    // Pending returns (currently checked out)
    const pendingReturns = await db.query(
      `SELECT COUNT(*) as count FROM Logs WHERE pending = TRUE AND returned = FALSE`
    );

    // Most borrowed equipment
    const mostBorrowed = await db.query(
      `SELECT equipmentBorrowed as equipment, COUNT(*) as count 
       FROM Logs 
       WHERE 1=1 ${dateFilter}
       GROUP BY equipmentBorrowed 
       ORDER BY count DESC 
       LIMIT 10`
    );

    // Most active borrowers
    const activeBorrowers = await db.query(
      `SELECT studentName as name, studentID as ashokaId, COUNT(*) as count 
       FROM Logs 
       WHERE 1=1 ${dateFilter}
       GROUP BY studentID, studentName 
       ORDER BY count DESC 
       LIMIT 10`
    );

    // Equipment currently checked out with availability
    const equipmentOut = await db.query(
      `SELECT 
        e.equipment,
        e.totalQuantity as total,
        e.inUseQuantity as inUse,
        (e.totalQuantity - e.reservedQuantity - e.damagedQuantity - e.inUseQuantity) as available
       FROM Equipment e
       WHERE e.inUseQuantity > 0
       ORDER BY e.inUseQuantity DESC`
    );

    const response = {
      totalCheckouts: totalCheckouts[0]?.count || 0,
      totalReturns: totalReturns[0]?.count || 0,
      activeUsers: activeUsers[0]?.count || 0,
      pendingReturns: pendingReturns[0]?.count || 0,
      mostBorrowed: mostBorrowed || [],
      activeBorrowers: activeBorrowers || [],
      equipmentOut: equipmentOut || [],
    };

    console.log(`[Statistics] Response:`, JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error("Error fetching statistics:", error);
    console.error("Stack trace:", error.stack);
    res.status(500).json({ 
      error: "Failed to fetch statistics",
      message: error.message 
    });
  }
});

app.get("/statistics", ensureAdmin, (req, res) => {
  res.render("dashboard", {
    activePage: "statistics",
    ...viewUser(req),
  });
});

app.post("/success", (req, res) => {
  const equipmentArray = req.body.issuedEquipment || [];

  // Group equipment by name and sum quantities
  const groupedEquipment = {};

  equipmentArray.forEach((item) => {
    const equipmentName = item.equipment || item;
    const quantity = item.outNum || 1;

    if (groupedEquipment[equipmentName]) {
      groupedEquipment[equipmentName] += quantity;
    } else {
      groupedEquipment[equipmentName] = quantity;
    }
  });

  // Convert grouped object back to array format
  const groupedArray = Object.keys(groupedEquipment).map((equipment) => ({
    equipment: equipment,
    outNum: groupedEquipment[equipment],
  }));

  res.render("success", {
    ...viewUser(req),
    studentName: req.body.name || "Unknown",
    mode: req.body.mode || "processed",
    equipment: groupedArray,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
