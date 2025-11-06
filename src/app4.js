import express from "express";
import mysql from "mysql2";
import moment from "moment-timezone";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import session from "express-session";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables FIRST
dotenv.config({ path: path.join(__dirname, "../.env") });

console.log("Running");
console.log("Database Config:", {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

const app = express();
const port = 3002; // Changed from 3000 to avoid conflicts (app5.js uses 3001, stats-dashboard uses 3000)

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));


const equipmentMap = {
  BDM: "Badminton Racket",
  SQH: "Squash",
  TNS: "Tennis",
  TTN: "Table Tennis",
  CHS: "Chess",
  CRM: "Carrom Coin",
  BSK: "Basketball",
  FTB: "Football",
  VLB: "Volleyball",
  YGM: "Yoga Mat",
  PKL: "Pickleball Racket",
  CYC: "Cycle",
  CRK: "Cricket Bat",
  WTM: "Weight Machine",
  BXG: "Boxing Gloves",
  WLK: "Washroom Locker Key",
  FSB: "Frisbee",
  FBL: "Foosball",
  DRB: "Daateball",
  POL: "Pool Sticks"
};



const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
};

console.log("Connecting to Railway MySQL...");
const db = mysql.createConnection(dbConfig);

db.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
    console.error("Connection details:", {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database,
      port: dbConfig.port
    });
    process.exit(1);
  }
  console.log("✅ Connected to Railway MySQL database");
});

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
  req.session.destroy(() => {});
  res.render("issue_login", {
    activePage: "issue", // highlight Issue page in navbar
  });
});

app.get("/inventory", (req, res) => {
  const query = "SELECT * FROM Inventory"; // your table name

  db.query(query, (err, results) => {
    if (err) {
      console.error("Database fetch error:", err);
      return res.status(500).render("error", {
        message: "Error fetching inventory data",
        error: process.env.NODE_ENV === "development" ? err : {}
      });
    }

    res.render("inventory", {
      activePage: "inventory",
      items: results || [],
      equipmentMap: equipmentMap,
    });
  });
});
app.post("/inventory/add", (req, res) => {
  const { equipmentId, issued, discard, repair, outOrder } = req.body;

  
  const checkQuery = `SELECT * FROM inventory WHERE equipmentId = ?`;

  db.query(checkQuery, [equipmentId], (err, results) => {
    if (err) {
      console.error("Database fetch error:", err);
      return res.status(500).send("Error checking inventory item");
    }

    if (results.length > 0) {
      
      const updateQuery = `
        UPDATE inventory
        SET issued = ?, discard = ?, repair = ?, outOrder = ?
        WHERE equipmentId = ?
      `;

      db.query(updateQuery, [issued, discard, repair, outOrder, equipmentId], (updateErr) => {
        if (updateErr) {
          console.error("Database update error:", updateErr);
          return res.status(500).send("Error updating inventory item");
        }
        res.redirect("/inventory");
      });

    } else {
      
      const insertQuery = `
        INSERT INTO inventory (equipmentId, issued, discard, repair, outOrder)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.query(insertQuery, [equipmentId, issued, discard, repair, outOrder], (insertErr) => {
        if (insertErr) {
          console.error("Database insert error:", insertErr);
          return res.status(500).send("Error adding inventory item");
        }
        res.redirect("/inventory");
      });
    }
  });
});

app.post("/inventory/update", (req, res) => {
  const { equipmentId, issued, discard, repair, outOrder } = req.body;

  if (!equipmentId) {
    console.error("Missing equipmentId");
    return res.status(400).json({ success: false, error: "Missing equipmentId" });
  }

  const query = `
    UPDATE inventory
    SET issued = ?, discard = ?, repair = ?, outOrder = ?
    WHERE equipmentId = ?
  `;

  db.query(query, [issued, discard, repair, outOrder, equipmentId], (err, result) => {
    if (err) {
      console.error("Database update error:", err);
      return res.status(500).json({ success: false, error: "Database update failed" });
    }

    if (result.affectedRows === 0) {
      console.warn("⚠️ No matching equipment found");
      return res.status(404).json({ success: false, error: "Item not found" });
    }

    console.log(`Updated equipment ${equipmentId}`);
    res.json({ success: true });
  });
});





app.post("/issue_login", (req, res) => {
  try {
    const ashokaId = req.body.qrString?.trim();
    
    if (!ashokaId) {
      console.log("❌ Login failed: No student ID provided");
      return res.status(400).send("Student ID is required");
    }
    
    const studentData = students.find(
      (s) => String(s.AshokaId).trim() === ashokaId
    );

    if (!studentData) {
      console.log(`❌ Login failed: Student ${ashokaId} not found`);
      return res.status(404).send("Student not found. Please check your ID.");
    }
    
    console.log("✅ Student authenticated:", studentData);
    req.session.student = studentData;
    res.redirect("/issue");
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).send("An error occurred during login");
  }
});
app.get("/issue", (req, res) => {
  if (!req.session.student) {
    console.log("⚠️ Unauthorized access to /issue - redirecting to login");
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
    "Volleyball":6,
    "Basketball":8,
    "Fooseball":2,
    "Yoga Mat":5,
    "Chess":3,
    "Cricket Bat": 4,
    "Frisbee":4,
    
  };

  db.query(
    `SELECT equipment, SUM(outNum) AS totalIssued
     FROM sports
     WHERE status = 'PENDING'
     GROUP BY equipment`,
    (err, results) => {
      if (err) {
        console.error("❌ Database error fetching issued items:", err);
        return res.status(500).send("Database error - please try again");
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
      console.log("📊 Available Items:", availableItems);

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
  if (!req.session.student) {
    console.log("⚠️ Unauthorized issue attempt");
    return res.status(401).send("Please log in first");
  }

  try {
    const outTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const quantity = req.body.quantity || {};

    // Filter equipment with non-zero quantity
    const equipmentList = Object.keys(quantity).filter(
      (item) => Number(quantity[item]) > 0
    );

    if (equipmentList.length === 0) {
      console.log("⚠️ No equipment selected");
      return res.redirect("/landing");
    }

    console.log(`📦 Issuing equipment to ${req.session.student.name}:`, equipmentList);

    let completed = 0;
    let hasError = false;

    equipmentList.forEach((item) => {
      const qtyToIssue = Number(quantity[item]);

      // Insert a new row for each issue
      db.query(
        "INSERT INTO sports (studentId, name, equipment, outNum, outTime, status, inNum) VALUES (?, ?, ?, ?, ?, 'PENDING', 0)",
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
            console.error("❌ Error issuing equipment:", insertErr);
            if (!res.headersSent) return res.status(500).send("Database error - please try again");
          }
          completed++;
          if (completed === equipmentList.length && !hasError) {
            console.log(`✅ Successfully issued ${equipmentList.length} items`);
            res.redirect("/landing");
          }
        }
      );
    });
  } catch (error) {
    console.error("❌ Issue error:", error);
    res.status(500).send("An error occurred while issuing equipment");
  }
});
app.get("/return_login", (req, res) => {
  req.session.destroy(() => {});
  res.render("return_login", {
    activePage: "landing", // highlight Landing/Return page
  });
});

app.post("/return_login", (req, res) => {
  try {
    const ashokaId = req.body.qrString?.trim();
    
    if (!ashokaId) {
      console.log("❌ Return login failed: No student ID provided");
      return res.status(400).send("Student ID is required");
    }
    
    const studentData = students.find(
      (s) => String(s.AshokaId).trim() === ashokaId
    );

    if (!studentData) {
      console.log(`❌ Return login failed: Student ${ashokaId} not found`);
      return res.status(404).send("Student not found. Please check your ID.");
    }

    console.log("✅ Student authenticated for return:", studentData);
    req.session.student = studentData;
    res.redirect("/landing");
  } catch (error) {
    console.error("❌ Return login error:", error);
    res.status(500).send("An error occurred during login");
  }
});
app.get("/landing", (req, res) => {
  if (!req.session.student) {
    console.log("⚠️ Unauthorized access to /landing - redirecting to login");
    return res.redirect("/return_login");
  }
  
  console.log(`📍 Landing page accessed by: ${req.session.student.name}`);
  res.render("landing_redirect", {
    ashokaId: req.session.student.AshokaId,
    activePage: "landing",
  });
});
app.post("/landing", async (req, res) => {
  try {
    const ashokaId = String(req.body.qrString).trim();
    const studentData = students.find((student) => {
      return String(student.AshokaId).trim() === String(ashokaId).trim();
    });
    
    if (!studentData) {
      console.log(`❌ Student ${ashokaId} not found`);
      return res.status(404).send("Student not found");
    }
    
    req.session.student = studentData;
    
    db.query(
      "SELECT studentId, name, equipment, outNum, inNum, status, outTime, inTime FROM sports WHERE studentId = ? AND status = 'PENDING'",
      [ashokaId],
      (err, results) => {
        if (err) {
          console.error("❌ Database error fetching pending items:", err);
          return res.status(500).send("Database error - please try again");
        }
        
        // Format outTime before sending to EJS
        results.forEach((r) => {
          r.outTime = moment(r.outTime)
            .tz("Asia/Kolkata")
            .format("ddd DD-MM-YYYY HH:mm:ss");
        });
        
        console.log(`📋 Found ${results.length} pending items for ${studentData.name}`);
        res.render("landing", { student: studentData, equipment: results });
      }
    );
  } catch (error) {
    console.error("❌ Landing page error:", error);
    res.status(500).send("An error occurred while loading your equipment");
  }
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
    `SELECT * FROM sports 
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
        `UPDATE sports 
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
      `SELECT * FROM sports 
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
          `UPDATE sports 
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
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
  });
  res.redirect("/");
});


app.listen(port);