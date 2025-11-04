// app.js
// ========================================================
// 📬 Sports Inventory + Auto Mailer (Borrow / Return / Overdue)
// ========================================================

import express from "express";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config / constants ----------
const PORT = process.env.PORT || 3001;
const LOGS_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
const LOG_FILE = path.join(LOGS_DIR, "email-log.txt");
const TEMPLATES_DIR = path.join(__dirname, "templates");

function logToFile(msg) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  console.log(msg);
}

// ---------- DB pool ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "sportsinventory",
  waitForConnections: true,
  connectionLimit: 10,
});

// ---------- Transporter (supports App Password or OAuth2) ----------
let transporter;
if (process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  logToFile("📧 Using Gmail App Password auth for transporter");
} else {
  if (
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_REFRESH_TOKEN ||
    !process.env.EMAIL_USER
  ) {
    logToFile(
      "⚠️ OAuth2 configuration incomplete and EMAIL_PASS not provided. Mailer will fail until configured."
    );
  }
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.EMAIL_USER,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    },
  });
  logToFile("📧 Using Gmail OAuth2 auth for transporter (if configured)");
}

// ---------- Load student -> email mapping ----------
const STUDENTS_FILE = path.join(__dirname, "students.json");
let studentData = [];
try {
  studentData = JSON.parse(fs.readFileSync(STUDENTS_FILE, "utf8"));
  logToFile(`🔍 Loaded ${studentData.length} students from students.json`);
} catch (e) {
  logToFile(`❌ Failed to load students.json: ${e.message}`);
  studentData = [];
}
function getEmailByStudentID(id) {
  const student = studentData.find(
    (s) => String(s.AshokaID) === String(id) || s.AshokaID === parseInt(id)
  );
  return student ? student.email : null;
}

// ---------- Template helpers ----------
function loadTemplateOrThrow(name) {
  const p = path.join(TEMPLATES_DIR, `${name}.html`);
  if (!fs.existsSync(p)) {
    throw new Error(`Missing template file: ${p}`);
  }
  return fs.readFileSync(p, "utf8");
}
function renderTemplate(templateStr, replacements) {
  let out = templateStr;
  for (const [k, v] of Object.entries(replacements || {})) {
    const regex = new RegExp(`{{\\s*${k}\\s*}}`, "g");
    out = out.replace(regex, v);
  }
  return out;
}

// ---------- Email logs helpers (email_logs table) ----------
async function logEmailSentDB(sportId, emailType) {
  // Use INSERT instead of INSERT IGNORE to allow multiple log entries
  await pool.query(
    "INSERT INTO email_logs (sport_id, email_type, sent_at) VALUES (?, ?, NOW())",
    [sportId, emailType]
  );
}

// ---------- Core: Update overdue status ----------
async function updateOverdueToLate() {
  try {
    logToFile("🔄 Running overdue updater (PENDING -> LATE)...");
    const [result] = await pool.query(`
      UPDATE sports
      SET status = 'LATE'
      WHERE status = 'PENDING'
        AND inTime IS NULL
        AND TIMESTAMPDIFF(HOUR, outTime, NOW()) >= 24
    `);
    logToFile(`   ✅ Updated ${result.affectedRows} record(s) to LATE`);
  } catch (err) {
    logToFile(`❌ updateOverdueToLate error: ${err.message}`);
  }
}

// ---------- Core: Email LATE borrowers ----------
async function emailLateBorrowers() {
  try {
    logToFile("🔍 Checking for LATE borrowers to email...");
    const [rows] = await pool.query(`
      SELECT id, studentID, name, equipment, outNum, outTime
      FROM sports
      WHERE status = 'LATE' AND inTime IS NULL
      ORDER BY studentID, id
    `);

    if (rows.length === 0) {
      logToFile("   ℹ️ No LATE records found");
      return;
    }

    logToFile(`   📋 Found ${rows.length} LATE record(s)`);

    const byStudent = {};
    
    // Group all LATE records by student (no filtering)
    for (const r of rows) {
      if (!byStudent[r.studentID])
        byStudent[r.studentID] = { name: r.name, records: [] };
      byStudent[r.studentID].records.push(r);
    }

    if (Object.keys(byStudent).length === 0) {
      logToFile("   ℹ️ No students to email");
      return;
    }

    const overdueTemplate = loadTemplateOrThrow("overdue");

    for (const [studentID, data] of Object.entries(byStudent)) {
      if (!data.records.length) continue;
      const email = getEmailByStudentID(studentID);
      if (!email) {
        logToFile(`⚠️ No email found for student ${studentID}; skipping`);
        continue;
      }

      const equipmentCounts = {};
      for (const rec of data.records) {
        const qty = Number(rec.outNum) || 1;
        equipmentCounts[rec.equipment] =
          (equipmentCounts[rec.equipment] || 0) + qty;
      }

      const equipmentLines = Object.entries(equipmentCounts)
        .map(([item, qty]) => `${item} - ${qty}`)
        .join("<br/>");

      const rendered = renderTemplate(overdueTemplate, {
        name: data.name,
        pendingEquipment: equipmentLines,
      });

      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: "⚠️ Sports Equipment Overdue Notice",
          html: rendered,
        });
        logToFile(
          `📧 OVERDUE sent to ${data.name} <${email}> (${data.records.length} recs)`
        );
        
        // Log each email sent for tracking purposes
        for (const rec of data.records) {
          await logEmailSentDB(rec.id, "OVERDUE");
        }
      } catch (err) {
        logToFile(`❌ Failed to send OVERDUE to ${email}: ${err.message}`);
      }
    }
  } catch (err) {
    logToFile(`❌ emailLateBorrowers error: ${err.message}`);
  }
}

// ---------- Schedule & polling ----------
async function checkAndNotifyOverdue() {
  await updateOverdueToLate();
  await emailLateBorrowers();
}

// ✅ FIX: Wrap async function properly for cron
cron.schedule("0 */6 * * *", () => {
  logToFile("⏰ Cron triggered: checkAndNotifyOverdue");
  checkAndNotifyOverdue().catch(err => {
    logToFile(`❌ Cron task error: ${err.message}`);
  });
});

const app = express();
app.get("/", (req, res) => res.send("📬 Sports Mailer Service running"));

app.listen(PORT, async () => {
  logToFile(`🚀 Mailer service started on port ${PORT}`);
  logToFile(`📅 Cron: Overdue checks every 6 hours (00:00, 06:00, 12:00, 18:00)`);
  
  try {
    logToFile(`🔍 Running initial overdue check...`);
    await checkAndNotifyOverdue();
    logToFile(`✅ Initial check complete`);
  } catch (err) {
    logToFile(`❌ Initial check error: ${err.message}`);
  }
});