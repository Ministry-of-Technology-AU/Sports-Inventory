import express from "express";
import mysql from "mysql2";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";
dotenv.config();

const app = express();
const port = 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

app.listen(port);

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "92GN6PZKdpsrkp",
  database: "SportsInventory",
  port: 3306,
};

const db = mysql.createConnection(dbConfig);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");

// Fix students.json path
const students = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../students.json"), "utf-8")
);

// If your views are in src/views, leave as is. If in root/views, use:
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

// Function to validate QR Code using API
// async function processQr(qrString) {
//   if (process.env.ENVIRONMENT == "DEVELOPMENT") {
//     return {
//       isValid: true,
//       ashokaId: decodeURIComponent(qrString.trim()),
//     };
//   } else {
//     qrString = decodeURIComponent(qrString.trim());
//     try {
//       // Ensure we have a valid token
//       if (!authToken) {
//         console.log("No Auth Token found. Attempting login...");
//         await login();
//       }

//       // Call ValidateQRCode API
//       const response = await fetch(
//         `${BASE_URL}api/TPIntegration/ValidateQRCodeTP`,
//         {
//           method: "POST",
//           headers: {
//             "Content-Type": "application/json",
//             Authorization: `Bearer ${authToken}`,
//           },
//           body: JSON.stringify({ QRCodeValue: qrString }),
//         }
//       );

//       const data = await response.json();

//       // If token is expired, refresh it and retry
//       if (data.ErrorCode !== 0 && data.ErrorMessage.includes("token")) {
//         console.warn("Token Expired. Refreshing...");
//         await refreshAuthToken();
//         return await processQr(qrString);
//       }

//       // If QR validation fails
//       if (data.ErrorCode !== 0) {
//         console.log(data.ErrorMessage);
//         return { isValid: false, error: data.ErrorMessage };
//       }

//       console.log("QR Code Validated Successfully.");
//       console.log("Ashoka ID:", data);
//       return {
//         isValid: true,
//         ashokaId: data.AshokaId,
//       };
//     } catch (error) {
//       console.error("QR Code Validation Error:", error.message);
//       return { isValid: false, error: error.message };
//     }
//   }
// }

app.get("/", (req, res) => {
  res.render("index");
});
app.get("/landing", (req, res) => {
  // If you have AshokaId in session, use it; otherwise, redirect to login
  if (!req.session.student) {
    return res.redirect("/");
  }
  // Render a form that auto-submits AshokaId to POST /landing
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
    "SELECT studentId, name, equipment, outNum, inNum, status, outTime, inTime FROM Sports WHERE studentId = ? AND status = 'PENDING'",
    [ashokaId],
    (err, results) => {
      if (err) return res.status(500).send("Database error");
      // Format outTime before sending to EJS
      results.forEach((r) => {
        r.formattedOutTime = moment(r.outTime)
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DD HH:mm:ss");
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
    `SELECT * FROM Sports 
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
        `UPDATE Sports 
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
app.get("/issue", (req, res) => {
  if (!req.session.student) {
    return res.redirect("/");
  }
  res.render("issue", { student: req.session.student, activePage: "issue" });
});
app.post("/issue", (req, res) => {
  const outTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  const quantity = req.body.quantity || {};

  // Filter equipment with non-zero quantity
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

    // Insert a new row for each issue
    db.query(
      "INSERT INTO Sports (studentId, name, equipment, outNum, outTime, status, inNum) VALUES (?, ?, ?, ?, ?, 'PENDING', 0)",
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

app.get("/return", (req, res) => {
  if (!req.session.student) {
    return res.redirect("/");
  }
  res.render("return", { student: req.session.student });
});
//returning the items
app.post("/return", (req, res) => {
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const quantity = req.body.quantity || {};

  // Filter equipment with non-zero quantity
  const equipmentList = Object.keys(quantity).filter(
    (item) => Number(quantity[item]) > 0
  );

  if (equipmentList.length === 0) {
    return res.redirect("/landing");
  }

  let completed = 0;
  let hasError = false;

  equipmentList.forEach((item) => {
    const qtyToReturn = Number(quantity[item]);

    // Select the oldest pending row for this equipment
    db.query(
      `SELECT * FROM Sports 
       WHERE studentId = ? AND equipment = ? AND status = 'PENDING'
       ORDER BY outTime ASC 
       LIMIT 1`,
      [req.session.student.AshokaId, item],
      (err, rows) => {
        if (err) {
          hasError = true;
          console.error("Error fetching pending row:", err);
          if (!res.headersSent) res.status(500).send("Database error");
          return;
        }

        if (!rows.length) {
          // No pending rows for this equipment
          completed++;
          if (completed === equipmentList.length && !hasError) {
            res.redirect("/landing");
          }
          return;
        }

        const row = rows[0];
        const newInNum = row.inNum + qtyToReturn;
        const newStatus = newInNum >= row.outNum ? "RETURNED" : "PENDING";

        db.query(
          `UPDATE Sports 
           SET inNum = ?, status = ?, inTime = ? 
           WHERE id = ?`,
          [newInNum, newStatus, returnTime, row.id],
          (updateErr) => {
            if (updateErr) {
              hasError = true;
              console.error("Error updating return:", updateErr);
              if (!res.headersSent) res.status(500).send("Database error");
            }
            completed++;
            if (completed === equipmentList.length && !hasError) {
              res.redirect("/landing");
            }
          }
        );
      }
    );
  });
});

//destroying session on logout
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
  });
  res.redirect("/");
});
