import express from "express";
import mysql from "mysql2/promise";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";
import passport from './passport-auth.js';
import MySQLStore from 'express-mysql-session';
import nodemailer from "nodemailer";

console.log("Running");
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

const port = process.env.PORT || 3000;

import db, { pool } from "./db.js";

app.set("view engine", "ejs");

const MySQLStoreSession = MySQLStore(session);
const sessionStoreOptions = {
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
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
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Load email templates
const BORROW_TEMPLATE = fs.readFileSync(path.join(__dirname, "../templates/borrow.html"), "utf-8");
const RETURN_TEMPLATE = fs.readFileSync(path.join(__dirname, "../templates/return.html"), "utf-8");

/**
 * Send borrow confirmation email
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 */
async function sendBorrowEmail(studentEmail, studentName, equipmentCounts) {
  try {
    // Format equipment list (e.g., "2x Cricket Bat, 1x Basketball")
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${qty}x ${equipment}`)
      .join(", ");

    // Replace placeholders in template
    const emailHtml = BORROW_TEMPLATE
      .replace(/{{name}}/g, studentName)
      .replace(/{{borrowedEquipment}}/g, equipmentList);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "Sports Equipment Borrowed - Confirmation",
      html: emailHtml
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(`📧 Borrow email sent to ${studentEmail} - MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(`❌ Failed to send borrow email to ${studentEmail}: ${error.message}`);
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
    // Format equipment list
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${qty}x ${equipment}`)
      .join(", ");

    // Replace placeholders in template
    const emailHtml = RETURN_TEMPLATE
      .replace(/{{name}}/g, studentName)
      .replace(/{{returnedEquipment}}/g, equipmentList);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "Sports Equipment Returned - Confirmation",
      html: emailHtml
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(`📧 Return email sent to ${studentEmail} - MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(`❌ Failed to send return email to ${studentEmail}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ========================================================
// END EMAIL SETUP
// ========================================================

// ========================================================
// OVERDUE TRACKING SYSTEM (CRON-BASED)
// ========================================================

// Update overdue items from PENDING to LATE status
async function updateOverdueToLate() {
  try {
    logToFile("🔄 Running overdue updater (pending -> late for overdue items)...");
    
    // Mark items as overdue if past dueOn date
    const result = await db.query(
      `UPDATE Logs
       SET pending = FALSE
       WHERE pending = TRUE 
         AND returned = FALSE 
         AND dueOn < NOW()`
    );
    const affectedRows = result.affectedRows || (Array.isArray(result) && result[0]?.affectedRows) || 0;
    logToFile(`   ✅ Updated ${affectedRows} record(s) to overdue status`);
    return affectedRows;
  } catch (err) {
    const errorCode = err.code || 'UNKNOWN';
    if (errorCode === 'ETIMEDOUT' || errorCode === 'ECONNREFUSED') {
      logToFile(`❌ updateOverdueToLate error [${errorCode}]: Database connection timeout`);
    } else if (errorCode === 'ER_NO_SUCH_TABLE') {
      logToFile(`❌ updateOverdueToLate error [${errorCode}]: Logs table does not exist`);
    } else if (errorCode === 'PROTOCOL_CONNECTION_LOST') {
      logToFile(`❌ updateOverdueToLate error [${errorCode}]: Database connection was lost`);
    } else {
      logToFile(`❌ updateOverdueToLate error [${errorCode}]: ${err.message}`);
    }
    throw err;
  }
}

// ========================================================
// END OVERDUE TRACKING SETUP
// ========================================================

const publicPaths = [
  '/auth/google',
  '/auth/google/callback',
  '/unauthorized',
];

app.use(session({
  key: 'mailroom_sid',
  secret: process.env.SECRET_KEY || 'your_session_secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Global authentication middleware
app.use((req, res, next) => {
  if (publicPaths && publicPaths.includes(req.path) || req.path.startsWith('/auth/')) {
    return next();
  }
  ensureAuthenticated(req, res, next);
});

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
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/unauthorized",
    failureMessage: true
  }),
  (req, res) => {
    if (req.session.messages) {
      console.error("Authentication failure:", req.session.messages);
    }

    const returnTo = req.session.returnTo || '/issue_login';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
      }
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});

app.get("/unauthorized", (req, res) => {
  res.render("error", { msg: "Unauthorized: Your email is not authorized to access this system." });
});

const BASE_URL = process.env.BASE_URL;

app.get("/", (req, res) => {
  res.render("issue_login", {
    activePage: "issue",
    user: req.user?.name || "Guest"
  });
});

app.get("/issue_login", (req, res) => {
  res.render("issue_login", {
    activePage: "issue",
    user: req.user?.name || "Guest"
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
    results.forEach(row => {
      // Available = Total - InUse - Pending
      availableItems[row.equipment] = row.totalQuantity - row.inUseQuantity - row.pendingCount;
    });

    callback(null, availableItems);
  });
}

app.get("/issue", (req, res) => {
  calculateAvailableEquipment((err, totalItems) => {
    if (err) {
      return res.status(500).send("Error calculating equipment");
    }

    res.render("issue", {
      student: req.session.student,
      availableItems: totalItems,
      activePage: "issue",
      user: req.user?.name || "Guest"
    });
  });
});


app.post("/issue", (req, res) => {
  const currentTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const quantity = req.body.quantity || {};

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

      let completed = 0;
      let hasError = false;
      const issuedEquipment = [];
      const insertedLogIds = [];

      equipmentList.forEach((item) => {
        const qtyToIssue = Number(quantity[item]);

        // Calculate due date (e.g., 7 days from now)
        const dueDate = moment().tz("Asia/Kolkata").add(7, 'days').format("YYYY-MM-DD HH:mm:ss");

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
            dueDate
          ],
          (insertErr, result) => {
            if (insertErr) {
              hasError = true;
              console.error("Error issuing equipment:", insertErr);
              if (!res.headersSent) return res.status(500).send("Database error");
            } else {
              // Store issued equipment details and log ID
              issuedEquipment.push({
                equipment: item,
                outNum: qtyToIssue
              });
              insertedLogIds.push({ id: result.insertId, equipment: item, qty: qtyToIssue });
            }

            completed++;

            if (completed === equipmentList.length && !hasError) {
              // All inserts complete - prepare equipment counts and send email
              const equipmentCounts = {};
              insertedLogIds.forEach(({ equipment, qty }) => {
                equipmentCounts[equipment] = qty;
              });

              // Send borrow confirmation email (non-blocking)
              sendBorrowEmail(studentEmail, req.session.student.name, equipmentCounts)
                .catch(err => {
                  console.error("Email send error:", err);
                  // Don't block the response on email failure
                });

              // Render success page with equipment details
              res.render("success", {
                studentName: req.session.student.name,
                equipment: issuedEquipment,
                mode: "Issued",
                user: req.user?.name || "Guest"
              });
            }
          }
        );
      });
    }
  );
});

app.get("/return_login", (req, res) => {
  res.render("return_login", {
    activePage: "landing",
    user: req.user?.name || "Guest"
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
    user: req.user?.name || "Guest"
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
    WHERE studentID = ? AND pending = TRUE AND returned = FALSE`,
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
        user: req.user?.name || "Guest"
      });
    }
  );
});

app.post('/getequipment', (req, res) => {
  db.query('SELECT equipment FROM Equipment', (err, rows) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const equipmentList = rows.map(row => row.equipment);
    console.log("Equipment List:", equipmentList);

    res.json({ equipment: equipmentList });
  });
});

app.post("/returnMany", (req, res) => {
  if (!req.session.student) {
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  const { equipments } = req.body;
  const studentId = req.session.student.AshokaId;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  if (!equipments || equipments.length === 0) {
    return res.json({ success: false, error: "No items selected" });
  }

  let completed = 0;
  let hasError = false;
  const returnedItems = {};

  equipments.forEach((equipment) => {
    db.query(
      `SELECT * FROM Logs 
       WHERE studentID = ? AND equipmentBorrowed = ? AND pending = TRUE AND returned = FALSE
       ORDER BY timestamp ASC 
       LIMIT 1`,
      [studentId, equipment],
      (err, rows) => {
        if (err || rows.length === 0) {
          console.error("DB fetch error:", err);
          hasError = true;
          completed++;
          if (completed === equipments.length) {
            return res.json({
              success: !hasError,
              error: hasError ? "Some returns failed" : null,
            });
          }
          return;
        }

        const row = rows[0];
        
        // Set returnedByID to NULL to avoid FK constraint violation
        // (FK requires Students.studentID, but we're inserting email strings)
        const returnedByID = null;
        const returnedByEmail = req.user?.email || null;
        
        db.query(
          `UPDATE Logs 
           SET pending = FALSE, 
               returned = TRUE, 
               returnedTimestamp = ?,
               returnedByID = ?,
               returnedByEmail = ?
           WHERE logID = ?`,
          [returnTime, returnedByID, returnedByEmail, row.logID],
          (updateErr) => {
            if (updateErr) {
              console.error("DB update error for equipment:", equipment, "logID:", row.logID);
              console.error("Error details:", updateErr);
              console.error("Values:", { returnTime, returnedByID, returnedByEmail, logID: row.logID });
              hasError = true;
            } else {
              console.log("Successfully returned:", equipment, "logID:", row.logID);
              // Track returned items
              returnedItems[equipment] = (returnedItems[equipment] || 0) + 1;
            }
            
            completed++;
            if (completed === equipments.length) {
              // All returns processed - send email if any succeeded
              if (!hasError && Object.keys(returnedItems).length > 0) {
                // Get student email from MySQL
                db.query(
                  "SELECT studentEmail, studentName FROM Students WHERE studentID = ?",
                  [studentId],
                  (emailErr, emailResults) => {
                    if (!emailErr && emailResults.length > 0) {
                      const { studentEmail, studentName } = emailResults[0];
                      // Send return confirmation email (non-blocking)
                      sendReturnEmail(studentEmail, studentName, returnedItems)
                        .catch(err => {
                          console.error("Return email send error:", err);
                        });
                    } else {
                      console.error("Could not fetch student email for return notification");
                    }
                  }
                );
              }

              res.json({
                success: !hasError,
                error: hasError ? "Some returns failed - check server logs" : null,
              });
            }
          }
        );
      }
    );
  });
});

app.post('/sports_request', (req, res) => {
  const { studentEmail, studentName, equipment, quantity, startDate, endDate } = req.body;

  if (!studentEmail || !studentName || !equipment || !quantity || !endDate) {
    return res.status(400).json({ message: "All fields are required." });
  }

  if (quantity <= 0) {
    return res.status(400).json({ message: "Quantity must be a positive number." });
  }

  const query = `
    INSERT INTO SportsRequests (studentEmail, studentName, equipment, quantity, startDate, endDate)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(query, [studentEmail, studentName, equipment, quantity, startDate, endDate], (err) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ message: "Database insert failed." });
    }
    res.json({ message: "Request submitted successfully!" });
  });
});

app.post('/update_inventory', (req, res) => {
  const inventory = req.body.inventory;

  for (const item of inventory) {
    if (!item.equipment || item.equipment.trim() === "") {
      return res.status(400).json({ error: `Equipment name cannot be empty.` });
    }

    const { reservedQuantity, damagedQuantity, inUseQuantity } = item;

    const nums = [reservedQuantity, damagedQuantity, inUseQuantity];
    if (nums.some(n => Number.isNaN(n) || n < 0)) {
      return res.status(400).json({ error: `Quantities must be non-negative numbers.` });
    }

    item.totalQuantity = reservedQuantity + damagedQuantity + inUseQuantity;
  }

  let completed = 0;

  inventory.forEach(item => {
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
        item.inUseQuantity
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
  });
});

app.get('/team_landing', (req, res) => {
  res.render('team_landing', {
    activePage: 'team-landing',
    user: req.user?.name || "Guest"
  });
});

app.get('/admin', (req, res) => {
  db.query('SELECT * FROM Equipment', (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error');
    }

    const equipmentData = results.map(row => ({
      equipment: row.equipment,
      totalQuantity: row.totalQuantity,
      reservedQuantity: row.reservedQuantity,
      damagedQuantity: row.damagedQuantity,
      inUseQuantity: row.inUseQuantity,
    }));

    console.log("Equipment Data:", equipmentData);

    res.render('admin', {
      activePage: 'admin',
      user: req.user?.name || "Guest",
      equipment: equipmentData
    });
  });
});

app.get('/statistics', (req, res) => {
  res.render('dashboard', {
    activePage: 'statistics',
    user: req.user?.name || "Guest"
  });
});

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  logToFile(`🚀 Sports Inventory service started on port ${port}`);
  }
);