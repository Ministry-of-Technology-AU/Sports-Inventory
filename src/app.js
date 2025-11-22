import express from "express";
import mysql from "mysql2";
import moment from "moment-timezone";
import path from "path";
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

// Static
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

const port = process.env.PORT || 3000;

// DB CONFIG
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  ssl:
    process.env.DB_HOST?.includes("railway") ||
    process.env.DB_HOST?.includes("rlwy.net")
      ? {
          rejectUnauthorized: false,
          minVersion: "TLSv1.2",
          maxVersion: "TLSv1.3",
        }
      : undefined,
};

console.log("Creating Railway MySQL connection pool...");
const db = mysql.createPool(dbConfig);

// Test DB Connection
async function testDatabaseConnection(retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await new Promise((res, rej) => {
        db.getConnection((err, c) => (err ? rej(err) : res(c)));
      });
      console.log("✅ Connected to Railway MySQL database");
      conn.release();
      return;
    } catch (err) {
      console.error(`❌ Attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt === retries)
        return console.warn("⚠️ Connection could not be verified");
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}
testDatabaseConnection();

// Views
app.set("views", path.join(__dirname, "../views"));
app.set("view engine", "ejs");

// Sessions
const MySQLStoreSession = MySQLStore(session);
const sessionStore = new MySQLStoreSession({
  ...dbConfig,
  schema: {
    tableName: "sessions",
    columnNames: { session_id: "session_id", expires: "expires", data: "data" },
  },
  expiration: 7 * 24 * 60 * 60 * 1000,
  checkExpirationInterval: 15 * 60 * 1000,
  createDatabaseTable: true,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    key: "mailroom_sid",
    secret: process.env.SECRET_KEY || "your_session_secret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Authentication Guard
const publicPaths = ["/auth/google", "/auth/google/callback", "/unauthorized"];

app.use((req, res, next) => {
  if (publicPaths.includes(req.path) || req.path.startsWith("/auth/"))
    return next();
  ensureAuthenticated(req, res, next);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/auth/google");
}

// GOOGLE LOGIN
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
    const returnTo = req.session.returnTo || "/issue_login";
    delete req.session.returnTo;
    return res.redirect(returnTo);
  }
);

app.get("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.redirect("/");
    });
  });
});

app.get("/unauthorized", (req, res) => {
  res.render("error", {
    msg: "Unauthorized: Your email is not authorized to access this system.",
  });
});

//------------------------------
// LOGIN & ISSUING
//------------------------------
app.get("/", (_, res) => res.redirect("/issue_login"));
app.get("/issue_login", (req, res) =>
  res.render("issue_login", {
    activePage: "issue",
    user: req.user?.name || "Guest",
  })
);

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

// SPORTS LOGIN CHECK
app.post("/issue_login_sports", (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  db.query(
    "SELECT sportsTeamAuthorised FROM Students WHERE studentID = ?",
    [ashokaId],
    (err, rows) => {
      if (err) return res.status(500).send("DB error");
      if (!rows.length) return res.status(404).send("Student not found");
      rows[0].sportsTeamAuthorised
        ? res.redirect("/issue_login")
        : res.render("error", {
            msg: "Unauthorized: Not a sports team member.",
          });
    }
  );
});

//------------------------------
// ISSUE EQUIPMENT
//------------------------------
function calculateAvailableEquipment(callback) {
  const q = `SELECT e.equipment, e.totalQuantity, e.inUseQuantity, COALESCE(COUNT(l.logID), 0) AS pendingCount
             FROM Equipment e LEFT JOIN Logs l
             ON e.equipment = l.equipmentBorrowed AND l.pending = TRUE
             GROUP BY e.equipment, e.totalQuantity, e.inUseQuantity`;
  db.query(q, (err, rows) => {
    if (err) return callback(err, null);
    const available = {};
    rows.forEach(
      (r) =>
        (available[r.equipment] =
          r.totalQuantity - r.inUseQuantity - r.pendingCount)
    );
    callback(null, available);
  });
}

app.get("/issue", (req, res) => {
  calculateAvailableEquipment((err, items) => {
    if (err) return res.status(500).send("DB error");
    res.render("issue", {
      student: req.session.student,
      availableItems: items,
      activePage: "issue",
      user: req.user?.name || "Guest",
    });
  });
});

app.post("/issue", (req, res) => {
  const currentTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
  const quantity = req.body.quantity || {};
  const eqList = Object.keys(quantity).filter((k) => Number(quantity[k]) > 0);
  if (!eqList.length) return res.redirect("/landing");

  db.query(
    "SELECT studentEmail, studentName FROM Students WHERE studentID = ?",
    [req.session.student.studentID],
    (err, r) => {
      if (err || !r.length)
        return res.status(500).send("Could not fetch student email");
      const email = r[0].studentEmail,
        name = r[0].studentName;

      let finished = 0,
        error = false;
      const issuedList = [];

      eqList.forEach((eq) => {
        const qty = +quantity[eq];
        const dueDate = moment()
          .tz("Asia/Kolkata")
          .add(7, "days")
          .format("YYYY-MM-DD HH:mm:ss");

        for (let i = 0; i < qty; i++) {
          db.query(
            "INSERT INTO Logs (timestamp, equipmentBorrowed, studentID, studentEmail, studentName, dueOn, pending, returned) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE)",
            [
              currentTime,
              eq,
              req.session.student.studentID,
              email,
              name,
              dueDate,
            ],
            (err2) => {
              if (err2) error = true;
            }
          );
        }

        issuedList.push({ equipment: eq, outNum: qty });
        finished++;
        if (finished === eqList.length && !error) {
          return res.render("success", {
            studentName: name,
            equipment: issuedList,
            user: req.user?.name || "Guest",
            mode: "issued",
          });
        }
      });
    }
  );
});

//------------------------------
// RETURN LOGIN
//------------------------------
app.get("/return_login", (req, res) => {
  res.render("return_login", {
    activePage: "landing",
    user: req.user?.name || "Guest",
  });
});

app.post("/return_login", (req, res) => {
  const id = req.body.qrString?.trim();
  db.query("SELECT * FROM Students WHERE studentID = ?", [id], (err, rows) => {
    if (err) return res.status(500).send("DB error");
    if (!rows.length) return res.status(404).send("Student not found");
    req.session.student = rows[0];
    res.redirect("/landing");
  });
});

//------------------------------
// LANDING (VIEW CURRENT ISSUES)
//------------------------------
app.get("/landing", (req, res) => {
  if (!req.session.student) return res.redirect("/return_login");
  res.render("landing_redirect", {
    ashokaId: req.session.student.studentID,
    activePage: "landing",
    user: req.user?.name || "Guest",
  });
});

app.post("/landing", (req, res) => {
  const id = req.body.qrString?.trim();
  db.query("SELECT * FROM Students WHERE studentID = ?", [id], (err, rows) => {
    if (err) return res.status(500).send("DB error");
    if (!rows.length) return res.status(404).send("Student not found");

    const student = rows[0];
    req.session.student = student;

    db.query(
      `SELECT logID, studentID, studentName, equipmentBorrowed AS equipment, timestamp AS outTime,
              dueOn, pending, returned, returnedTimestamp AS inTime
       FROM Logs WHERE studentID = ? AND pending = TRUE AND returned = FALSE`,
      [id],
      (e2, res2) => {
        if (e2) return res.status(500).send("DB error");
        res2.forEach((r) => {
          r.outTime = moment(r.outTime)
            .tz("Asia/Kolkata")
            .format("ddd DD-MM-YYYY HH:mm:ss");
          r.dueOn = moment(r.dueOn)
            .tz("Asia/Kolkata")
            .format("ddd DD-MM-YYYY HH:mm:ss");
        });
        res.render("landing", {
          student,
          equipment: res2,
          user: req.user?.name || "Guest",
        });
      }
    );
  });
});

//------------------------------
// RETURN MANY (BRANCH 2 LOGIC)
//------------------------------
app.post("/returnMany", (req, res) => {
  if (!req.session.student) return res.redirect("/return_login");

  const studentId = req.session.student.studentID;
  const email = req.session.student.studentEmail;
  const returnTime = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

  let returnedLogIDs =
    req.body["logsReturned[]"] || req.body.logsReturned || [];
  returnedLogIDs = Array.isArray(returnedLogIDs)
    ? returnedLogIDs
    : [returnedLogIDs];

  let damagedLogIDs = req.body["logsDamaged[]"] || req.body.logsDamaged || [];
  damagedLogIDs = Array.isArray(damagedLogIDs)
    ? damagedLogIDs
    : [damagedLogIDs];

  if (!returnedLogIDs.length) return res.redirect("/landing");

  let done = 0,
    error = false;

  returnedLogIDs.forEach((logID) => {
    const isDamaged = damagedLogIDs.includes(String(logID));
    db.query(
      `UPDATE Logs SET pending = FALSE, returned = TRUE, returnedTimestamp = ?, returnedByID = ?, returnedByEmail = ?, damaged = ? WHERE logID = ?`,
      [returnTime, studentId, email, isDamaged ? "Yes" : "No", logID],
      (e) => {
        if (e) error = true;
        done++;
        if (done === returnedLogIDs.length) {
          if (error)
            return res.render("error", {
              msg: "Some items could not be returned.",
              user: req.user?.name || "Guest",
            });

          db.query(
            `SELECT logID, equipmentBorrowed AS equipment FROM Logs WHERE logID IN (${returnedLogIDs
              .map(() => "?")
              .join(",")})`,
            returnedLogIDs,
            (e3, r3) => {
              if (e3)
                return res.render("error", {
                  msg: "Error preparing summary.",
                  user: req.user?.name || "Guest",
                });

              const grouped = {};
              r3.forEach((r) => {
                if (!grouped[r.equipment])
                  grouped[r.equipment] = {
                    equipment: r.equipment,
                    quantity: 0,
                    damaged: 0,
                  };
                grouped[r.equipment].quantity++;
                if (damagedLogIDs.includes(String(r.logID)))
                  grouped[r.equipment].damaged++;
              });

              res.render("return_success", {
                studentName: req.session.student.studentName,
                equipment: Object.values(grouped),
                user: req.user?.name || "Guest",
              });
            }
          );
        }
      }
    );
  });
});

//------------------------------
// SPORTS REQUEST
//------------------------------
app.post("/sports_request", (req, res) => {
  const { studentEmail, studentName, equipment, quantity, startDate, endDate } =
    req.body;
  if (!studentEmail || !studentName || !equipment || !quantity || !endDate)
    return res.status(400).json({ message: "All fields required." });
  if (quantity <= 0)
    return res.status(400).json({ message: "Quantity must be positive." });

  db.query(
    "SELECT reservedQuantity FROM Equipment WHERE equipment = ?",
    [equipment],
    (err, rows) => {
      if (err || !rows.length)
        return res.status(500).json({ message: "Lookup failed." });
      if (quantity > rows[0].reservedQuantity)
        return res
          .status(400)
          .json({
            message: `Insufficient reserved. Max ${rows[0].reservedQuantity}`,
          });

      db.query(
        "INSERT INTO SportsRequests (studentEmail, studentName, equipment, quantity, startDate, endDate) VALUES (?, ?, ?, ?, ?, ?)",
        [studentEmail, studentName, equipment, quantity, startDate, endDate],
        (e2) => {
          if (e2) return res.status(500).json({ message: "Insert failed." });
          db.query(
            "UPDATE Equipment SET reservedQuantity = reservedQuantity - ?, inUseQuantity = inUseQuantity + ? WHERE equipment = ?",
            [quantity, quantity, equipment],
            (e3) => {
              if (e3)
                return res
                  .status(500)
                  .json({ message: "Inventory update failed." });
              res.json({
                message: "Sports request submitted and inventory updated!",
              });
            }
          );
        }
      );
    }
  );
});

//------------------------------
// ADMIN PANEL
//------------------------------
app.get("/admin", (req, res) => {
  db.query("SELECT * FROM Equipment", (err, eqRows) => {
    if (err) return res.status(500).send("Database error");
    const equipmentData = eqRows.map((r) => ({
      equipment: r.equipment,
      totalQuantity: r.totalQuantity,
      reservedQuantity: r.reservedQuantity,
      damagedQuantity: r.damagedQuantity,
      inUseQuantity: r.inUseQuantity,
    }));

    db.query(
      `SELECT studentID, studentName, studentEmail, borrowedNotOutstanding, borrowedOutstanding, offences FROM Students WHERE offences > 0`,
      (err2, offRows) => {
        if (err2) return res.status(500).send("Database error");
        const offenceList = offRows.map((r) => ({
          studentID: r.studentID,
          studentName: r.studentName,
          studentEmail: r.studentEmail,
          borrowedNotOutstanding: r.borrowedNotOutstanding,
          borrowedOutstanding: r.borrowedOutstanding,
          offences: r.offences,
        }));

        db.query(
          `SELECT equipmentBorrowed AS equipment, studentID, studentName, studentEmail, timestamp AS issuedOn, returnedTimestamp AS returnedOn FROM Logs WHERE damaged = 'Yes'`,
          (err3, dmgRows) => {
            if (err3) return res.status(500).send("Database error");
            const damagedList = dmgRows.map((r) => ({
              equipment: r.equipment,
              studentID: r.studentID,
              studentName: r.studentName,
              studentEmail: r.studentEmail,
              issuedOn: moment(r.issuedOn)
                .tz("Asia/Kolkata")
                .format("DD-MM-YYYY HH:mm"),
              returnedOn: r.returnedOn
                ? moment(r.returnedOn)
                    .tz("Asia/Kolkata")
                    .format("DD-MM-YYYY HH:mm")
                : "Not Returned",
            }));

            res.render("admin", {
              activePage: "admin",
              user: req.user?.name || "Guest",
              equipment: equipmentData,
              offenceList,
              damagedEquipmentList: damagedList,
            });
          }
        );
      }
    );
  });
});

app.get("/statistics", (req, res) =>
  res.render("dashboard", {
    activePage: "statistics",
    user: req.user?.name || "Guest",
  })
);

//-----------------
app.listen(port, () => console.log(`Server running on port ${port}`));
