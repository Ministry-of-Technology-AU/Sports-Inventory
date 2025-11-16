import express from "express";
import mysql from "mysql2";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";
import passport from "./passport-auth.js";
import MySQLStore from "express-mysql-session";

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
  ssl:
    process.env.DB_HOST?.includes("railway") ||
    process.env.DB_HOST?.includes("rlwy.net")
      ? {
          rejectUnauthorized: false, // Accept self-signed certs
          minVersion: "TLSv1.2", // MySQL 9.4.0 requirement
          maxVersion: "TLSv1.3", // Support latest TLS
        }
      : undefined,
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

      console.log(
        "✅ Connected to Railway MySQL database with connection pool"
      );
      connection.release();
      return true;
    } catch (err) {
      console.error(
        `❌ Database connection attempt ${attempt}/${retries} failed:`,
        err.message
      );

      if (attempt === retries) {
        console.error("Connection details:", {
          host: dbConfig.host,
          user: dbConfig.user,
          database: dbConfig.database,
          port: dbConfig.port,
          ssl: dbConfig.ssl ? "enabled" : "disabled",
        });
        console.warn("⚠️ App will continue but database operations may fail");
        console.warn(
          "💡 Tip: Check if your Railway MySQL service is active and not paused"
        );
        return false;
      }

      console.log(`⏳ Retrying in ${delay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
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

const sessionStore = new MySQLStoreSession(sessionStoreOptions);

const publicPaths = ["/auth/google", "/auth/google/callback", "/unauthorized"];

app.use(
  session({
    key: "mailroom_sid",
    secret: process.env.SECRET_KEY || "your_session_secret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Global authentication middleware
app.use((req, res, next) => {
  if (
    (publicPaths && publicPaths.includes(req.path)) ||
    req.path.startsWith("/auth/")
  ) {
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

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
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
  req.logout(function (err) {
    if (err) return next(err);

    req.session.destroy(() => {
      res.clearCookie("connect.sid");

      // Redirect to Google logout, then back to your site
      const googleLogoutUrl =
        "https://accounts.google.com/Logout?continue=https://www.google.com&continue=" +
        encodeURIComponent(process.env.BASE_URL || "http://localhost:3000");

      return res.redirect(googleLogoutUrl);
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
  });
});

app.post("/issue_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim();

  db.query(
    "SELECT * FROM Students WHERE studentID = ?",
    [ashokaId],
    (err, rows) => {
      if (err) return res.status(500).send("DB error");
      if (!rows.length) return res.status(404).send("Student not found");

      req.session.student = rows[0];
      res.redirect("/issue");
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

app.get("/issue", (req, res) => {
  calculateAvailableEquipment((err, totalItems) => {
    if (err) {
      return res.status(500).send("Error calculating equipment");
    }

    res.render("issue", {
      student: req.session.student,
      availableItems: totalItems,
      activePage: "issue",
      user: req.user?.name || "Guest",
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
    [req.session.student.studentID],
    (emailErr, emailResults) => {
      if (emailErr || emailResults.length === 0) {
        console.error("Error fetching student email:", emailErr);
        return res.status(500).send("Could not find student email");
      }

      const studentEmail = emailResults[0].studentEmail;

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
            req.session.student.studentID,
            studentEmail,
            req.session.student.studentName,
            dueDate,
          ],
          (insertErr) => {
            if (insertErr) {
              hasError = true;
              console.error("Error issuing equipment:", insertErr);
              if (!res.headersSent)
                return res.status(500).send("Database error");
            } else {
              // Store issued equipment details
              issuedEquipment.push({
                equipment: item,
                outNum: qtyToIssue,
              });
            }

            completed++;

            if (completed === equipmentList.length && !hasError) {
              // Render success page with equipment details
              res.render("success", {
                studentName: req.session.student.studentName,
                equipment: issuedEquipment,
                user: req.user?.name || "Guest",
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
    user: req.user?.name || "Guest",
  });
});

app.post("/return_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  db.query(
    "SELECT * FROM Students WHERE studentID = ?",
    [ashokaId],
    (err, rows) => {
      if (err) return res.status(500).send("DB error");
      if (!rows.length) return res.status(404).send("Student not found");

      req.session.student = rows[0];
      res.redirect("/landing");
    }
  );
});

app.get("/landing", (req, res) => {
  if (!req.session.student) {
    return res.redirect("/return_login");
  }
  res.render("landing_redirect", {
    ashokaId: req.session.student.studentID,
    activePage: "landing",
    user: req.user?.name || "Guest",
  });
});

app.post("/landing", async (req, res) => {
  const ashokaId = String(req.body.qrString).trim();
  const studentData = req.session.student;

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
      });
    }
  );
});

app.get("/getequipment", (req, res) => {
  db.query("SELECT equipment, reservedQuantity FROM Equipment", (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });

    res.json(
      rows.map((r) => ({
        equipment: r.equipment,
        reservedQuantity: r.reservedQuantity,
      }))
    );
  });
});

app.post("/returnMany", (req, res) => {
  if (!req.session.student) {
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  const { equipments } = req.body;
  const studentId = req.session.student.studentID;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  if (!equipments || equipments.length === 0) {
    return res.json({ success: false, error: "No items selected" });
  }

  let completed = 0;
  let hasError = false;

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

        const row = rows[0];
        db.query(
          `UPDATE Logs 
           SET pending = FALSE, 
               returned = TRUE, 
               returnedTimestamp = ?,
               returnedByID = ?,
               returnedByEmail = ?
           WHERE logID = ?`,
          [returnTime, studentId, req.session.student.studentEmail, row.logID],
          (updateErr) => {
            if (updateErr) {
              console.error("DB update error:", updateErr);
              hasError = true;
            }
            completed++;
            if (completed === equipments.length)
              res.json({
                success: !hasError,
                error: hasError ? "Some returns failed" : null,
              });
          }
        );
      }
    );
  });
});

app.post("/sports_request", (req, res) => {
  const { studentEmail, studentName, equipment, quantity, startDate, endDate } =
    req.body;

  // Basic validation
  if (!studentEmail || !studentName || !equipment || !quantity || !endDate) {
    return res.status(400).json({ message: "All fields are required." });
  }

  if (quantity <= 0) {
    return res
      .status(400)
      .json({ message: "Quantity must be a positive number." });
  }

  // 1. First fetch reservedQuantity for that equipment
  const getQtyQuery = `
    SELECT reservedQuantity, inUseQuantity 
    FROM Equipment
    WHERE equipment = ?
  `;

  db.query(getQtyQuery, [equipment], (err, rows) => {
    if (err || rows.length === 0) {
      console.error(err);
      return res.status(500).json({ message: "Equipment lookup failed." });
    }

    const reserved = rows[0].reservedQuantity;

    // 2. Check if enough reserved quantity exists
    if (quantity > reserved) {
      return res.status(400).json({
        message: `Insufficient reserved stock. Max allowed: ${reserved}`,
      });
    }

    // 3. Insert sports request
    const insertRequestQuery = `
      INSERT INTO SportsRequests 
      (studentEmail, studentName, equipment, quantity, startDate, endDate)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
      insertRequestQuery,
      [studentEmail, studentName, equipment, quantity, startDate, endDate],
      (err2) => {
        if (err2) {
          console.error(err2);
          return res.status(500).json({ message: "Request insert failed." });
        }

        // 4. Update Equipment: reserved -= qty, inUse += qty
        const updateEquipmentQuery = `
          UPDATE Equipment
          SET reservedQuantity = reservedQuantity - ?,
              inUseQuantity = inUseQuantity + ?
          WHERE equipment = ?
        `;

        db.query(
          updateEquipmentQuery,
          [quantity, quantity, equipment],
          (err3) => {
            if (err3) {
              console.error(err3);
              return res
                .status(500)
                .json({ message: "Failed to update inventory." });
            }

            // Everything done
            res.json({
              message: "Sports request submitted and inventory updated!",
            });
          }
        );
      }
    );
  });
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
app.post("/delete_equipment", (req, res) => {
  const { equipment } = req.body;

  if (!equipment) {
    return res.status(400).json({ message: "Equipment name missing." });
  }

  db.query(
    "DELETE FROM Equipment WHERE TRIM(LOWER(equipment)) = TRIM(LOWER(?))",
    [equipment],
    (err, result) => {
      if (err) {
        console.error("Delete error:", err);
        return res.status(500).json({ message: "Database error." });
      }

      if (result.affectedRows === 0) {
        return res.json({ message: "Item not found in database." });
      }

      return res.json({ message: "Equipment deleted successfully." });
    }
  );
});

app.get("/team_landing", (req, res) => {
  res.render("team_landing", {
    activePage: "team-landing",
    user: req.user?.name || "Guest",
  });
});

app.get("/admin", (req, res) => {
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
    // Query offences list
    db.query(
      `SELECT studentID, studentName, studentEmail, borrowedNotOutstanding,
              borrowedOutstanding, offences
       FROM Students WHERE offences > 0`,
      (err2, offenceQueryResults) => {
        if (err2) return res.status(500).send("Database error");

        const offenceResults = offenceQueryResults.map((row) => ({
          studentID: row.studentID,
          studentName: row.studentName,
          studentEmail: row.studentEmail,
          borrowedNotOutstanding: row.borrowedNotOutstanding,
          borrowedOutstanding: row.borrowedOutstanding,
          offences: row.offences,
        }));

        res.render("admin", {
          activePage: "admin",
          user: req.user?.name || "Guest",
          equipment: equipmentData,
          offenceList: offenceResults,
        });
      }
    );
  });
});

app.get("/statistics", (req, res) => {
  res.render("dashboard", {
    activePage: "statistics",
    user: req.user?.name || "Guest",
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
