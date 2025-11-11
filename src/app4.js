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
  port: process.env.DB_PORT,
};

const db = mysql.createConnection(dbConfig);

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

// 1. Basic setup - ORDER MATTERS!
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = new MySQLStoreSession(sessionStoreOptions);

app.use(session({
  key: 'mailroom_sid',
  secret: process.env.SECRET_KEY || 'your_session_secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // secure: process.env.NODE_ENV === 'production', // Set to true in production when using HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.set("views", path.join(__dirname, "../views"));
app.set("view engine", "ejs");

// Fix students.json path
const students = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../students.json"), "utf-8")
);

// PUBLIC ROUTES FIRST - Define these BEFORE authentication middleware

// Auth routes
app.get("/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/unauthorized",
    failureMessage: true
  }),
  (req, res) => {
    // Log any failure messages from the authentication process
    if (req.session.messages) {
      console.error("Authentication failure:", req.session.messages);
    }

    const returnTo = req.session.returnTo || '/issue_login';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
      }
      res.clearCookie("mailroom_sid"); // Use the same key as in session config
      res.redirect("/");
    });
  });
});

app.get("/unauthorized", (req, res) => {
  res.render("error", { msg: "Unauthorized: Your email is not authorized to access this system." });
});

// AUTHENTICATION MIDDLEWARE - Applied to all routes below this point
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/google");
}

app.use(ensureAuthenticated);

// PROTECTED ROUTES - All routes below require authentication

const BASE_URL = process.env.BASE_URL;

app.get("/", (req, res) => {
  res.render("issue_login", {
    activePage: "issue",
  });
});

app.get("/issue_login", (req, res) => {
  res.render("issue_login", {
    activePage: "issue",
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

app.get("/issue", (req, res) => {
  if (!req.session.student) {
    return res.redirect("/");
  }

  const totalItems = {
    "Badminton Racquet": 20,
    "Table Tennis Racquet": 15,
    "Squash Racquet": 10,
    "Tennis Racquet": 12,
    "Pickleball Racquet": 8,
    "Pool Stick": 5,
    "Cycle": 7,
    "Football": 10,
    "Volleyball": 6,
    "Basketball": 8,
    "Fooseball": 2,
    "Yoga Mat": 5,
    "Chess": 3,
    "Cricket Bat": 4,
    "Frisbee": 4,
  };

  db.query(
    `SELECT equipment, SUM(outNum) AS totalIssued
     FROM SPORTS
     WHERE status = 'PENDING'
     GROUP BY equipment`,
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Database error");
      }

      const issuedItems = {};
      results.forEach((row) => {
        issuedItems[row.equipment] = row.totalIssued;
      });

      const availableItems = {};
      for (const equipment in totalItems) {
        availableItems[equipment] =
          totalItems[equipment] - (issuedItems[equipment] || 0);
      }
      console.log("Available Items:", availableItems);

      res.render("issue", {
        student: req.session.student,
        availableItems: availableItems,
        activePage: "issue",
      });
    }
  );
});

app.post("/issue", (req, res) => {
  const outTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const quantity = req.body.quantity || {};

  const equipmentList = Object.keys(quantity).filter(
    (item) => Number(quantity[item]) > 0
  );

  if (equipmentList.length === 0) {
    return res.redirect("/landing");
  }

  let completed = 0;
  let hasError = false;

  equipmentList.forEach((item) => {
    const qtyToIssue = Number(quantity[item]);

    db.query(
      "INSERT INTO SPORTS (studentId, name, equipment, outNum, outTime, status, inNum) VALUES (?, ?, ?, ?, ?, 'PENDING', 0)",
      [
        req.session.student.AshokaId,
        req.session.student.name,
        item,
        qtyToIssue,
        outTime,
      ],
      (insertErr) => {
        if (insertErr) {
          hasError = true;
          console.error("Error issuing equipment:", insertErr);
          if (!res.headersSent) return res.status(500).send("Database error");
        }
        completed++;
        if (completed === equipmentList.length && !hasError) {
          res.redirect("/landing");
        }
      }
    );
  });
});

app.get("/return_login", (req, res) => {
  res.render("return_login", {
    activePage: "landing",
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
    "SELECT studentId, name, equipment, outNum, inNum, status, outTime, inTime FROM SPORTS WHERE studentId = ? AND status = 'PENDING'",
    [ashokaId],
    (err, results) => {
      if (err) return res.status(500).send("Database error");
      results.forEach((r) => {
        r.outTime = moment(r.outTime)
          .tz("Asia/Kolkata")
          .format("ddd DD-MM-YYYY HH:mm:ss");
      });
      res.render("landing", { student: studentData, equipment: results });
    }
  );
});

app.post("/returnOne", (req, res) => {
  if (!req.session.student) {
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  const equipment = req.body.equipment;
  const studentId = req.session.student.AshokaId;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  db.query(
    `SELECT * FROM SPORTS 
     WHERE studentId = ? AND equipment = ? AND status = 'PENDING'
     ORDER BY outTime ASC 
     LIMIT 1`,
    [studentId, equipment],
    (err, rows) => {
      if (err) {
        console.error("DB fetch error:", err);
        return res.json({ success: false, error: "Database error" });
      }

      if (rows.length === 0) {
        return res.json({ success: false, error: "No pending items" });
      }

      const row = rows[0];
      const newInNum = row.outNum;
      const newStatus = "RETURNED";

      db.query(
        `UPDATE SPORTS 
         SET inNum = ?, status = ?, inTime = ? 
         WHERE id = ?`,
        [newInNum, newStatus, returnTime, row.id],
        (updateErr) => {
          if (updateErr) {
            console.error("DB update error:", updateErr);
            return res.json({ success: false, error: "Database update error" });
          }

          res.json({ success: true });
        }
      );
    }
  );
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

  equipments.forEach((equipment) => {
    db.query(
      `SELECT * FROM SPORTS 
       WHERE studentId = ? AND equipment = ? AND status = 'PENDING'
       ORDER BY outTime ASC 
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
          `UPDATE SPORTS 
           SET inNum = ?, status = ?, inTime = ? 
           WHERE id = ?`,
          [row.outNum, "RETURNED", returnTime, row.id],
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

app.get('/team_landing', (req, res) => {
  res.render('team_landing', {
    activePage: 'team-landing',
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});