import express from "express";
import mysql from "mysql2";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";

console.log("Running");
const app = express();
const port = 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

app.listen(port);

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
};

const db = mysql.createConnection(dbConfig);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");

// Fix students.json path
const students = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../students.json"), "utf-8")
);

app.set("views", path.join(__dirname, "../views"));

//setting up session management
app.use(
  session({
    secret: "superSecretKey123", // any random string (used to sign the session ID cookie)
    resave: false, // don’t save session if nothing changed
    saveUninitialized: false, // don’t create session until something stored
    cookie: {
      maxAge: 1000 * 60 * 60, // cookie valid for 1 hour (in ms)
    },
  })
);

const BASE_URL = process.env.BASE_URL;

app.get("/", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
  });
  res.render("issue_login", {
    activePage: "issue",
  });
});
app.get("/issue_login", (req, res) => {
  req.session.destroy(() => { });
  res.render("issue_login", {
    activePage: "issue", // highlight Issue page in navbar
  });
});
app.post("/issue_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim(); // note your input is named qrString
  const studentData = students.find(
    (s) => String(s.AshokaId).trim() === ashokaId
  );

  if (!studentData) return res.status(404).send("Student not found");
  console.log("Student Data:", studentData);
  req.session.student = studentData;
  res.redirect("/issue"); // GET /issue will set activePage
});
app.get("/issue", (req, res) => {
  if (!req.session.student) {
    return res.redirect("/");
  }

  //prettier-ignore
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

      // Transform DB result into an object
      const issuedItems = {};
      results.forEach((row) => {
        issuedItems[row.equipment] = row.totalIssued;
      });

      // Calculate available items
      const availableItems = {};
      for (const equipment in totalItems) {
        availableItems[equipment] =
          totalItems[equipment] - (issuedItems[equipment] || 0);
      }
      console.log("Available Items:", availableItems);

      // Render page inside the callback
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

  // Filter equipment with non-zero quantity
  const equipmentList = Object.keys(quantity).filter(
    (item) => Number(quantity[item]) > 0
  );

  if (equipmentList.length === 0) {
    x;
    return res.redirect("/landing");
  }

  let completed = 0;
  let hasError = false;

  equipmentList.forEach((item) => {
    const qtyToIssue = Number(quantity[item]);

    // Insert a new row for each issue
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
          res.redirect("/landing"); //made the change right here from app2.js
        }
      }
    );
  });
});
app.get("/return_login", (req, res) => {
  req.session.destroy(() => { });
  res.render("return_login", {
    activePage: "landing", // highlight Landing/Return page
  });
});

app.post("/return_login", (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  const studentData = students.find(
    (s) => String(s.AshokaId).trim() === ashokaId
  );

  if (!studentData) return res.status(404).send("Student not found");

  req.session.student = studentData;
  res.redirect("/landing"); // GET /landing will set activePage
});
app.get("/landing", (req, res) => {
  // If you have AshokaId in session, use it; otherwise, redirect to login
  // Render a form that auto-submits AshokaId to POST /landing
  if (!req.session.student) {
    return res.redirect("/return_login"); // redirect if no student session
  }
  res.render("landing_redirect", {
    ashokaId: req.session.student.AshokaId,
    activePage: "landing",
  });
});
app.post("/landing", async (req, res) => {
  // var processedQr = processQr(req.body.qrString);
  // if (processedQr.isValid) {
  const ashokaId = String(req.body.qrString).trim();
  const studentData = students.find((student) => {
    return String(student.AshokaId).trim() === String(ashokaId).trim();
  });
  // });
  if (!studentData) {
    return res.status(404).send("Student not found");
  }
  req.session.student = studentData; // store in session
  db.query(
    "SELECT studentId, name, equipment, outNum, inNum, status, outTime, inTime FROM SPORTS WHERE studentId = ? AND status = 'PENDING'",
    [ashokaId],
    (err, results) => {
      if (err) return res.status(500).send("Database error");
      // Format outTime before sending to EJS
      results.forEach((r) => {
        r.outTime = moment(r.outTime)
          .tz("Asia/Kolkata")
          .format("ddd DD-MM-YYYY HH:mm:ss");
      });
      res.render("landing", { student: studentData, equipment: results });
    }
  );
  // } else {
  //   res.status(400).send("Invalid QR");
  // }
}); // <-- Add this closing brace
app.post("/returnOne", (req, res) => {
  if (!req.session.student) {
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  const equipment = req.body.equipment;
  const studentId = req.session.student.AshokaId;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  // Fetch the oldest pending row for that equipment
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
      const newInNum = row.outNum; // returning all at once
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
    // Add any other data your template needs
  });
});


app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
  });
  res.redirect("/");
});
