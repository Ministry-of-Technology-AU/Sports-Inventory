import express from "express";
import mysql from "mysql2";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";
import passport from './passport-auth.js';
import MySQLStore from 'express-mysql-session';

console.log("Running");
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

const port = process.env.PORT || 3000;

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000, // 30 seconds for Railway
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Railway MySQL 9.4.0 uses self-signed SSL certificates
  // Must set rejectUnauthorized: false to accept them
  ssl: process.env.DB_HOST?.includes('railway') || process.env.DB_HOST?.includes('rlwy.net')
    ? {
      rejectUnauthorized: false,  // Accept self-signed certs
      minVersion: 'TLSv1.2',      // MySQL 9.4.0 requirement
      maxVersion: 'TLSv1.3'       // Support latest TLS
    }
    : undefined
};

console.log("Creating Railway MySQL connection pool...");
const db = mysql.createPool(dbConfig);

// Test connection on startup with retry logic
async function testDatabaseConnection(retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const connection = await new Promise((resolve, reject) => {
        db.getConnection((err, conn) => {
          if (err) reject(err);
          else resolve(conn);
        });
      });

      console.log("✅ Connected to Railway MySQL database with connection pool");
      connection.release();
      return true;
    } catch (err) {
      console.error(`❌ Database connection attempt ${attempt}/${retries} failed:`, err.message);

      if (attempt === retries) {
        console.error("Connection details:", {
          host: dbConfig.host,
          user: dbConfig.user,
          database: dbConfig.database,
          port: dbConfig.port,
          ssl: dbConfig.ssl ? 'enabled' : 'disabled'
        });
        console.warn("⚠️ App will continue but database operations may fail");
        console.warn("💡 Tip: Check if your Railway MySQL service is active and not paused");
        return false;
      }

      console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

// Start connection test
testDatabaseConnection();

app.set("view engine", "ejs");

const MySQLStoreSession = MySQLStore(session);
const sessionStoreOptions = {
  ...dbConfig,
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

const sessionStore = new MySQLStoreSession(sessionStoreOptions);

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

app.post("/issue_login_sports", (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  // In the Students table, check under the column sportsTeamAuthorised
  // If yes, redirected to endpoint /issue_login 
  // Else, render error page with message "not sports team authorised"
  db.query(
    "SELECT sportsTeamAuthorised FROM Students WHERE AshokaId = ?",
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
        res.render("error", { msg: "Unauthorized: You are not authorised as a sports team member." });
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
    results.forEach(row => {
      // Available = Total - InUse - Pending
      availableItems[row.equipment] = row.totalQuantity - row.inUseQuantity - row.pendingCount;
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
    results.forEach(row => {
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
        const currentDate = new Date().toISOString().split('T')[0];

        console.log("Querying with information: ", studentEmail, studentName, currentDate);

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
                errorMsg: "No valid sports equipment request found for your account. Please use the regular issue portal.",
                user: req.user?.name || "Guest"
              });
            }

            // Transform results to match the frontend's expected format
            const equipment = results.map(item => ({
              equipment: item.equipment,
              outNum: item.quantity,
              outTime: item.approvedOn || new Date().toISOString()
            }));

            // Render the team issue page
            res.render("team_issue", {
              student: req.session.student,
              equipment: equipment,
              activePage: "issue",
              user: req.user?.name || "Guest"
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
      results.forEach(row => {
        availableItems[row.equipment] = row.available;
      });

      res.render("issue", {
        student: req.session.student,
        availableItems: availableItems,
        activePage: "issue",
        user: req.user?.name || "Guest"
      });
    }
  );
});

// Regular issue endpoint - POST
app.post("/issue", (req, res) => {
  const currentTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const quantity = req.body.quantity || {};

  // Get list of equipment to issue (where quantity > 0)
  const equipmentList = Object.keys(quantity).filter(item => Number(quantity[item]) > 0);

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
      const placeholders = equipmentList.map(() => '?').join(',');

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
          availResults.forEach(row => {
            availabilityMap[row.equipment] = row.available;
          });

          for (let item of equipmentList) {
            const requested = Number(quantity[item]);
            const available = availabilityMap[item] || 0;

            if (requested > available) {
              return res.status(400).send(
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
            const dueDate = moment().tz("Asia/Kolkata").add(7, 'days').format("YYYY-MM-DD HH:mm:ss");

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
                  dueDate
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
                        outNum: Number(quantity[eq])
                      });
                    });

                    // Render success page with equipment details
                    res.render("success", {
                      studentName: req.session.student.name,
                      equipment: issuedEquipment,
                      user: req.user?.name || "Guest",
                      mode: "issued"
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
  const currentDate = new Date().toISOString().split('T')[0];

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
      const placeholders = selectedEquipments.map(() => '?').join(',');

      console.log("Querying issue with the following info: ", studentEmail, studentName, selectedEquipments, currentDate);

      // First, get the equipment details before updating
      db.query(
        `SELECT equipment, quantity FROM SportsRequests 
         WHERE studentEmail = ? 
         AND studentName = ? 
         AND equipment IN (${placeholders})
         AND startDate <= ? 
         AND endDate >= ? 
         AND (issued IS NULL OR issued = FALSE)`,
        [studentEmail, studentName, ...selectedEquipments, currentDate, currentDate],
        (err, equipmentResults) => {
          if (err) {
            console.error("Database error:", err);
            return res.json({ success: false, error: "Database error" });
          }

          if (equipmentResults.length === 0) {
            return res.json({
              success: false,
              error: "No valid requests found to issue"
            });
          }

          // Store equipment in session for success page
          req.session.issuedEquipment = equipmentResults.map(item => ({
            equipment: item.equipment,
            outNum: item.quantity
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
            [studentEmail, studentName, ...selectedEquipments, currentDate, currentDate],
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
  const returnedEquipment = [];

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
          if (completed === equipments.length)
            return res.json({
              success: !hasError,
              error: hasError ? "Some returns failed" : null,
            });
          return;
        }
        const ashokaId = req.body.qrString?.trim();

        const row = rows[0];

        // Track returned equipment
        returnedEquipment.push({
          equipment: row.equipmentBorrowed,
          outNum: row.quantityBorrowed
        });

        db.query(
          `UPDATE Logs 
           SET pending = FALSE, 
               returned = TRUE, 
               returnedTimestamp = ?,
               returnedByID = ?,
               returnedByEmail = ?
           WHERE logID = ?`,
          [returnTime, ashokaId, ashokaId, row.logID],
          (updateErr) => {
            if (updateErr) {
              console.error("DB update error:", updateErr);
              hasError = true;
            }
            completed++;
            if (completed === equipments.length) {
              // Store in session and render success page
              req.session.returnedEquipment = returnedEquipment;
              // make a get request to /success
              return res.json({ success: !hasError });
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

app.post('/success', (req, res) => {
  res.render('success', {
    user: req.user?.name || "Guest",
    studentName: req.body.name || "Unknown",
    mode: req.body.mode || "processed",
    equipment: req.body.issuedEquipment || []
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});