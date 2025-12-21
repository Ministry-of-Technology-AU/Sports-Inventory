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
import cron from "node-cron";

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
async function sendOverdueEmail(studentEmail, studentName, equipmentCounts) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = OVERDUE_TEMPLATE.replace(
      /{{name}}/g,
      studentName
    ).replace(/{{pendingEquipment}}/g, equipmentList);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "⚠️ Sports Equipment Overdue - Return Required",
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Overdue email sent to ${studentEmail} - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send overdue email to ${studentEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

// ========================================================
// OVERDUE TRACKING & CRON JOB
// ========================================================

// Track when we last sent overdue emails to students (one per day limit)
const overdueEmailTracker = new Map(); // studentID -> lastEmailDate (YYYY-MM-DD)

/**
 * Check for overdue items and send reminder emails
 * Items are overdue if dueOn date has passed (based on dueOn field from schema)
 */
async function checkAndNotifyOverdue() {
  try {
    logToFile("🔄 Running overdue check...");

    const now = moment().tz("Asia/Kolkata");
    const currentTime = now.format("YYYY-MM-DD HH:mm:ss");
    const today = now.format("YYYY-MM-DD");

    // Find all logs where equipment is still pending and dueOn date has passed
    // Using the dueOn field from the schema which is set during issue
    const overdueQuery = `
      SELECT 
        l.studentID,
        l.studentName,
        l.studentEmail,
        l.equipmentBorrowed,
        COUNT(*) as quantity,
        MIN(l.timestamp) as oldestBorrow,
        MIN(l.dueOn) as earliestDue
      FROM Logs l
      WHERE l.pending = TRUE 
        AND l.returned = FALSE
        AND l.dueOn < ?
      GROUP BY l.studentID, l.studentName, l.studentEmail, l.equipmentBorrowed
    `;

    const overdueItems = await db.query(overdueQuery, [currentTime]);

    if (overdueItems.length === 0) {
      logToFile("   ✅ No overdue items found");
      return;
    }

    // Group by student
    const studentOverdueMap = new Map();

    overdueItems.forEach((item) => {
      if (!studentOverdueMap.has(item.studentID)) {
        studentOverdueMap.set(item.studentID, {
          studentEmail: item.studentEmail,
          studentName: item.studentName,
          equipment: {},
        });
      }

      const student = studentOverdueMap.get(item.studentID);
      student.equipment[item.equipmentBorrowed] = item.quantity;
    });

    logToFile(
      `   📊 Found ${studentOverdueMap.size} students with overdue equipment`
    );

    // Send emails (one per student per day)
    for (const [studentID, data] of studentOverdueMap.entries()) {
      const lastEmailDate = overdueEmailTracker.get(studentID);

      // Check if we already sent an email today
      if (lastEmailDate === today) {
        logToFile(
          `   ⏭️  Skipping ${data.studentName} - already emailed today`
        );
        continue;
      }

      // Send overdue email
      const result = await sendOverdueEmail(
        data.studentEmail,
        data.studentName,
        data.equipment
      );

      if (result.success) {
        // Mark as emailed today
        overdueEmailTracker.set(studentID, today);
        logToFile(`   ✅ Sent overdue notification to ${data.studentName}`);
      }
    }

    logToFile("🏁 Overdue check complete");
  } catch (error) {
    logToFile(`❌ Error in overdue check: ${error.message}`);
    console.error("Overdue check error:", error);
  }
}

// Schedule cron job to run every 12 hours (at 8 AM and 8 PM)
// Format: "minute hour * * *" where * means every day
cron.schedule(
  "0 8,20 * * *",
  () => {
    logToFile("⏰ Cron job triggered: Starting overdue check");
    checkAndNotifyOverdue();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

// Run once on startup (after a short delay to let DB initialize)
setTimeout(() => {
  logToFile("🚀 Running initial overdue check on startup");
  checkAndNotifyOverdue();
}, 5000);

// ========================================================
// END OVERDUE TRACKING
// ========================================================

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
  // Public paths don't need any authentication
  if (
    req.path.startsWith("/auth") ||
    req.path === "/" ||
    req.path === "/issue_login" ||
    req.path === "/return_login" ||
    req.path === "/logout" ||
    req.path === "/unauthorized"
  ) {
    return next();
  }

  // Admin pages require OAuth authentication
  const adminPaths = ["/admin", "/statistics", "/dashboard"];
  if (adminPaths.includes(req.path)) {
    return ensureAuthenticated(req, res, next);
  }

  // Student pages (/issue, /landing, etc.) require student session (QR code login)
  const studentPaths = ["/issue", "/landing", "/team_landing"];
  if (studentPaths.includes(req.path)) {
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

  // For POST routes and other paths, allow if either auth method is present
  if (req.session.student || req.isAuthenticated()) {
    return next();
  }

  // Default: redirect to issue login
  res.redirect("/issue_login");
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
    user: req.user?.name || "Guest",
    isAuthenticated: req.isAuthenticated(),
  });
});

app.get("/issue_login", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/auth/google");
  }
  res.render("issue_login", {
    activePage: "issue",
    user: req.user.name,
    isAuthenticated: true,
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
  // In the Students table, check under the column sportsTeamAuthorised
  // If yes, redirected to endpoint /issue_login
  // Else, render error page with message "not sports team authorised"
  db.query(
    "SELECT sportsTeamAuthorised FROM Students WHERE studentID = ?",
    [ashokaId],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Database error");
      }

      if (results.length === 0) {
        return res.status(404).send("Student not found");
      }

      const isAuthorised = results[0].sportsTeamAuthorised;

      if (isAuthorised) {
        res.redirect("/issue_login");
      } else {
        res.render("error", {
          msg: "Unauthorized: You are not authorised as a sports team member.",
        });
      }
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

// Sports team issue endpoint
app.get("/issue_team", (req, res) => {
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
                user: req.user?.name || "Guest",
                isAuthenticated: req.isAuthenticated(),
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
              activePage: "issue",
              user: req.user?.name || "Guest",
              isAuthenticated: req.isAuthenticated(),
            });
          }
        );
      }
    );
  });
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
        user: req.user?.name || "Guest",
        isAuthenticated: req.isAuthenticated(),
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

                    // Render success page with equipment details
                    res.render("success", {
                      studentName: req.session.student.name,
                      equipment: issuedEquipment,
                      user: req.user?.name || "Guest",
                      isAuthenticated: req.isAuthenticated(),
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

app.post("/issue_team_equipment", (req, res) => {
  const selectedEquipments = req.body.equipments;
  const studentName = req.session.student.name;
  const currentDate = new Date().toISOString().split("T")[0];

  if (!selectedEquipments || selectedEquipments.length === 0) {
    return res.json({ success: false, error: "No equipment selected" });
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

      // Create placeholders for the IN clause
      const placeholders = selectedEquipments.map(() => "?").join(",");

      console.log(
        "Querying issue with the following info: ",
        studentEmail,
        studentName,
        selectedEquipments,
        currentDate
      );

      // First, get the equipment details before updating
      db.query(
        `SELECT equipment, quantity FROM SportsRequests 
         WHERE studentEmail = ? 
         AND studentName = ? 
         AND equipment IN (${placeholders})
         AND startDate <= ? 
         AND endDate >= ? 
         AND (issued IS NULL OR issued = FALSE)`,
        [
          studentEmail,
          studentName,
          ...selectedEquipments,
          currentDate,
          currentDate,
        ],
        (err, equipmentResults) => {
          if (err) {
            console.error("Database error:", err);
            return res.json({ success: false, error: "Database error" });
          }

          if (equipmentResults.length === 0) {
            return res.json({
              success: false,
              error: "No valid requests found to issue",
            });
          }

          // Store equipment in session for success page
          req.session.issuedEquipment = equipmentResults.map((item) => ({
            equipment: item.equipment,
            outNum: item.quantity,
          }));

          // Update issued status for selected equipment
          db.query(
            `UPDATE SportsRequests 
             SET issued = TRUE 
             WHERE studentEmail = ? 
             AND studentName = ? 
             AND equipment IN (${placeholders})
             AND startDate <= ? 
             AND endDate >= ? 
             AND (issued IS NULL OR issued = FALSE)`,
            [
              studentEmail,
              studentName,
              ...selectedEquipments,
              currentDate,
              currentDate,
            ],
            (err, results) => {
              if (err) {
                console.error("Database error:", err);
                return res.json({ success: false, error: "Database error" });
              }

              res.json({ success: true });
            }
          );
        }
      );
    }
  );
});

app.get("/return_login", (req, res) => {
  res.render("return_login", {
    activePage: "landing",
    user: req.user?.name || "Guest",
    isAuthenticated: req.isAuthenticated(),
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
    user: req.user?.name || "Guest",
    isAuthenticated: req.isAuthenticated(),
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
        user: req.user?.name || "Guest",
        isAuthenticated: req.isAuthenticated(),
      });
    }
  );
});

app.post("/getequipment", (req, res) => {
  db.query("SELECT equipment FROM Equipment", (err, rows) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const equipmentList = rows.map((row) => row.equipment);
    console.log("Equipment List:", equipmentList);

    res.json({ equipment: equipmentList });
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
        `SELECT logID FROM Logs
         WHERE logID = ? AND studentID = ? AND pending = TRUE AND returned = FALSE`,
        [logID, studentId]
      );

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
  const { studentEmail, studentName, equipment, quantity, startDate, endDate } =
    req.body;

  // Validation
  if (!studentEmail || !studentName || !equipment || !quantity || !endDate) {
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
    (studentEmail, studentName, equipment, quantity, startDate, endDate)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(
    query,
    [studentEmail, studentName, equipment, quantity, startDate, endDate],
    (err, result) => {
      if (err) {
        console.error("Error inserting sports request:", err);
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      return res.status(201).json({
        success: true,
        message: "Sports request submitted successfully",
        requestId: result.insertId,
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
    user: req.user?.name || "Guest",
    isAuthenticated: req.isAuthenticated(),
  });
});

app.get("/admin", ensureAuthenticated, (req, res) => {
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
      user: req.user?.name || "Guest",
      isAuthenticated: req.isAuthenticated(),
      equipment: equipmentData,
    });
  });
});

app.get("/statistics", ensureAuthenticated, (req, res) => {
  res.render("dashboard", {
    activePage: "statistics",
    user: req.user?.name || "Guest",
    isAuthenticated: req.isAuthenticated(),
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
    user: req.user?.name || "Guest",
    isAuthenticated: req.isAuthenticated(),
    studentName: req.body.name || "Unknown",
    mode: req.body.mode || "processed",
    equipment: groupedArray,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
