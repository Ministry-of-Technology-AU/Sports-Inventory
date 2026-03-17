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
import { logToFile } from "./utils/logger.js";
import { sendBorrowEmail, sendReturnEmail, sendOverdueEmail, sendTeamBorrowEmail, sendTeamReturnEmail, sendTeamOverdueEmail } from "./utils/email.js";
import { OVERDUE_THRESHOLD_HOURS, OVERDUE_THRESHOLD_MINUTES, scheduleOverdueTimeout, cancelOverdueTimeout, processOverdueItem, rescheduleAllOverdueTimeouts, checkAndMarkOverdueItems, scheduleOverdueForRecentIssues } from "./services/overdue.js";
import prisma from "./prisma.js";
import { Prisma } from "@prisma/client";

console.log("Running");
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

// Serve static files from "style" folder
app.use("/style", express.static(path.join(__dirname, "../style")));
app.use("/images", express.static(path.join(__dirname, "../images")));

const port = process.env.PORT || 3000;

// Raw mysql2 pool - ONLY used for express-mysql-session store
import { createPool } from "mysql2/promise";
const pool = createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

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
  // ================= PUBLIC / API / FETCH ROUTES =================
  if (
    // ---------- Auth & landing ----------
    req.path.startsWith("/auth") ||
    req.path === "/" ||
    req.path === "/logout" ||
    req.path === "/unauthorized" ||
    // ---------- Static assets ----------
    req.path.startsWith("/style") ||
    req.path.startsWith("/images") ||
    // ---------- FETCH / API routes ----------
    req.path === "/getequipment" ||
    req.path === "/get_offences" ||
    req.path === "/sports_request" ||
    req.path === "/update_inventory" ||
    req.path === "/delete_inventory" ||
    req.path === "/returnMany" ||
    req.path === "/issue_team_equipment" ||
    req.path === "/return_team_equipment" ||
    req.path === "/store-success-data" ||
    req.path === "/api/check-overdue" || // Webhook endpoint
    req.path === "/api/statistics" || // Statistics API endpoint
    // ---------- QR / login endpoints ----------
    req.path === "/issue_login" ||
    req.path === "/issue_login_sports" ||
    req.path === "/return_login" ||
    req.path === "/issue_team_login" ||
    req.path === "/team_return_login" ||
    // ---------- Public landings ----------
    req.path === "/landing" ||
    req.path === "/team_landing" ||
    req.path === "/show-success"
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
    if (req.session.student) {
      return next();
    }
    // Redirect to appropriate login page
    if (req.path === "/issue") {
      return res.redirect("/issue_login");
    }
    return res.redirect("/return_login");
  }

  // HARD BLOCK: team issue / return must use QR ONLY
  const qrOnlyPaths = [
    "/issue_team",
    "/team_return",
    "/issue_team_equipment",
    "/return_team_equipment",
  ];

  if (qrOnlyPaths.includes(req.path)) {
    if (!req.session.student) {
      return res.redirect(
        req.path.startsWith("/team_return")
          ? "/team_return_login"
          : "/issue_team_login"
      );
    }
    return next();
  }

  // Default: redirect to issue login
  res.redirect("/issue_login");
});

function viewUser(req) {
  return {
    user: req.user?.name || "",
    isAuthenticated: req.isAuthenticated(),
    isAdmin: req.user?.role === "admin",
  };
}

function requireStudent(req, res, next) {
  if (req.session.student) {
    return next();
  }

  // Return-side pages
  const returnPages = ["/landing"];

  if (returnPages.includes(req.path)) {
    return res.redirect("/return_login");
  }

  // Issue-side pages
  return res.redirect("/issue_login");
}
function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user?.role === "admin") {
    return next();
  }
  // Handle API requests with JSON response
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({
      error: "Forbidden: Admin access only"
    });
  }
  // Handle page requests with HTML error page
  return res.status(403).render("error", {
    msg: "Forbidden: Admin access only",
  });
}

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
    user: req.user || {},
    ...viewUser(req),
  });
});

app.get("/issue_login", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/auth/google");
  }
  res.render("issue_login", {
    activePage: "issue",
    user: req.user,
    ...viewUser(req),
  });
});

// ================= STUDENT LOGIN ROUTES =================

app.post("/issue_login", async (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  try {
    const student = await prisma.student.findUnique({
      where: { studentID: ashokaId },
      select: { studentID: true, studentName: true, studentEmail: true },
    });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    const studentData = {
      AshokaId: student.studentID,
      name: student.studentName,
      email: student.studentEmail,
    };

    // console.log("Student Data:", studentData);
    req.session.student = studentData;
    res.redirect("/issue");
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).send("Database error");
  }
});

app.post("/issue_login_sports", async (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  try {
    const student = await prisma.student.findUnique({
      where: { studentID: ashokaId },
      select: { studentID: true, studentName: true, studentEmail: true, sportsTeamAuthorised: true },
    });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    if (!student.sportsTeamAuthorised) {
      return res.render("error", {
        msg: "Unauthorized: You are not authorised as a sports team member.",
      });
    }

    req.session.student = {
      AshokaId: student.studentID,
      name: student.studentName,
      email: student.studentEmail,
    };

    req.session.save(() => {
      res.redirect("/issue_team");
    });
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).send("Database error");
  }
});

// ================= HELPER FUNCTIONS =================

async function calculateAvailableEquipment() {
  const equipmentList = await prisma.equipment.findMany({
    select: {
      name: true,
      totalQuantity: true,
      inUseQuantity: true,
      _count: {
        select: {
          logs: { where: { status: "pending" } },
        },
      },
    },
  });

  const availableItems = {};
  equipmentList.forEach((row) => {
    availableItems[row.name] =
      row.totalQuantity - row.inUseQuantity - row._count.logs;
  });
  return availableItems;
}

async function getInUseEquipment() {
  const equipmentList = await prisma.equipment.findMany({
    select: { name: true, inUseQuantity: true },
  });

  const inUseItems = {};
  equipmentList.forEach((row) => {
    inUseItems[row.name] = row.inUseQuantity;
  });
  return inUseItems;
}

// ================= TEAM ISSUE QR LOGIN =================
app.get("/issue_team_login", (req, res) => {
  req.session.student = null; // FORCE fresh QR
  res.render("issue_login", {
    activePage: "team-landing",
    viewUser: viewUser(req),
  });
});

// Sports team issue endpoint
app.get("/issue_team", async (req, res) => {
  if (!req.session.student) {
    return res.redirect("/issue_team_login");
  }

  try {
    const student = await prisma.student.findUnique({
      where: { studentID: req.session.student.AshokaId },
      select: { studentEmail: true },
    });

    if (!student) {
      return res.status(500).send("Could not find student email");
    }

    const studentEmail = student.studentEmail;
    const currentDate = new Date();

    // Check for valid sports request
    const requests = await prisma.sportsRequest.findMany({
      where: {
        studentEmail: studentEmail,
        startDate: { lte: currentDate },
        endDate: { gte: currentDate },
        status: "pending",
      },
      include: {
        equipment: { select: { name: true } },
      },
    });

    if (requests.length === 0) {
      return res.render("error", {
        errorMsg:
          "No valid sports equipment request found for your account. Please use the regular issue portal.",
        ...viewUser(req),
      });
    }

    // Transform results to match the frontend's expected format
    const equipment = requests.map((item) => ({
      equipment: item.equipment.name,
      outNum: item.quantity,
      outTime: item.approvedOn || new Date().toISOString(),
    }));

    // Render the team issue page
    res.render("team_issue", {
      student: req.session.student,
      equipment: equipment,
      activePage: "team-landing",
      ...viewUser(req),
    });
  } catch (err) {
    console.error("Error loading team issue page:", err);
    res.status(500).send("Database error");
  }
});

app.get("/team_return_login", (req, res) => {
  req.session.student = null; // force fresh QR

  res.render("team_return_login", {
    activePage: "team-return",
    ...viewUser(req),
  });
});

app.get("/team_return", async (req, res) => {
  if (!req.session.student) {
    return res.redirect("/team_return_login");
  }

  const student = req.session.student;

  try {
    // Use raw query for GROUP BY with aggregation (Prisma groupBy doesn't support relations)
    const rows = await prisma.$queryRaw`
      SELECT
        e.name AS equipment,
        COUNT(*) AS outNum,
        MIN(l.timestamp) AS outTime
      FROM Logs l
      JOIN Equipment e ON l.equipmentID = e.equipmentID
      WHERE l.studentID = ${student.AshokaId}
        AND l.isTeamIssue = TRUE
        AND l.status = 'pending'
      GROUP BY e.name
    `;

    const equipment = rows.map((row) => ({
      equipment: row.equipment,
      outNum: Number(row.outNum),
      outTime: moment(row.outTime)
        .tz("Asia/Kolkata")
        .format("ddd DD-MM-YYYY HH:mm:ss"),
    }));

    res.render("team_return", {
      student,
      equipment,
      activePage: "team-return",
      ...viewUser(req),
    });
  } catch (err) {
    console.error("Error loading team return page:", err);
    res.status(500).send("Failed to load team return page");
  }
});

app.post("/team_return_login", async (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  try {
    const student = await prisma.student.findUnique({
      where: { studentID: ashokaId },
      select: { studentID: true, studentName: true, studentEmail: true },
    });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    req.session.student = {
      AshokaId: student.studentID,
      name: student.studentName,
      email: student.studentEmail,
    };

    res.redirect("/team_return");
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).send("Database error");
  }
});

// ================= TEAM RETURN =================
app.post("/return_team_equipment", requireStudent, async (req, res) => {
  const equipments =
    typeof req.body.equipments === "string"
      ? JSON.parse(req.body.equipments)
      : req.body.equipments;

  const studentId = req.session.student.AshokaId;
  const returnTime = new Date();

  if (!equipments || equipments.length === 0) {
    return res.json({ success: false, error: "No equipment provided" });
  }

  try {
    const returnedCounts = {};

    await prisma.$transaction(async (tx) => {
      // 1. Mark Logs as returned
      for (const item of equipments) {
        const { equipment: equipmentName, outNum } = item;
        returnedCounts[equipmentName] =
          (returnedCounts[equipmentName] || 0) + Number(outNum);

        // Find the equipment ID
        const equip = await tx.equipment.findUnique({
          where: { name: equipmentName },
          select: { equipmentID: true },
        });

        if (!equip) {
          throw new Error(`Equipment "${equipmentName}" not found`);
        }

        const logs = await tx.log.findMany({
          where: {
            studentID: studentId,
            equipmentID: equip.equipmentID,
            isTeamIssue: true,
            status: "pending",
          },
          select: { logID: true },
          take: Number(outNum),
        });

        if (logs.length < outNum) {
          throw new Error(`Not enough team-issued ${equipmentName} found to return`);
        }

        for (const log of logs) {
          cancelOverdueTimeout(log.logID);

          await tx.log.update({
            where: { logID: log.logID },
            data: {
              status: "returned",
              returnedTimestamp: returnTime,
            },
          });
        }
      }

      // 2. Update Equipment inventory
      for (const [equipmentName, qty] of Object.entries(returnedCounts)) {
        const equip = await tx.equipment.findUnique({
          where: { name: equipmentName },
        });

        if (!equip) {
          throw new Error(`Equipment "${equipmentName}" not found while updating inventory`);
        }

        await tx.equipment.update({
          where: { name: equipmentName },
          data: {
            reservedQuantity: { decrement: qty },
            inUseQuantity: { increment: qty },
          },
        });
      }

      // 3. Sync SportsRequests status
      for (const equipmentName of Object.keys(returnedCounts)) {
        const equip = await tx.equipment.findUnique({
          where: { name: equipmentName },
          select: { equipmentID: true },
        });

        const totalIssued = await tx.log.count({
          where: {
            studentID: studentId,
            equipmentID: equip.equipmentID,
            isTeamIssue: true,
          },
        });

        const totalReturned = await tx.log.count({
          where: {
            studentID: studentId,
            equipmentID: equip.equipmentID,
            isTeamIssue: true,
            status: { in: ["returned", "overdue_returned"] },
          },
        });

        if (totalIssued === totalReturned) {
          const studentRecord = await tx.student.findUnique({
            where: { studentID: studentId },
            select: { studentEmail: true },
          });

          await tx.sportsRequest.updateMany({
            where: {
              equipmentID: equip.equipmentID,
              status: "issued",
              studentEmail: studentRecord.studentEmail,
            },
            data: { status: "returned" },
          });
        }
      }
    });

    // Send team return confirmation email
    const student = req.session.student;
    const studentRecord = await prisma.student.findUnique({
      where: { studentID: studentId },
      select: { studentEmail: true },
    });

    if (studentRecord) {
      const studentEmail = studentRecord.studentEmail;
      const returnDate = moment().tz("Asia/Kolkata").format("MMMM D, YYYY");

      const issueLog = await prisma.log.findFirst({
        where: { studentID: studentId, isTeamIssue: true },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true },
      });

      const issueDate = issueLog
        ? moment(issueLog.timestamp).tz("Asia/Kolkata").format("MMMM D, YYYY")
        : "N/A";

      const teamName = "Sports Team";
      const sportType = Object.keys(returnedCounts).join(", ");
      const equipmentStatus = "All equipment returned successfully";

      await sendTeamReturnEmail(
        studentEmail,
        student.name,
        teamName,
        sportType,
        returnedCounts,
        issueDate,
        returnDate,
        equipmentStatus
      );
    }

    res.render("success", {
      ...viewUser(req),
      studentName: student.name,
      mode: "returned",
      equipment: Object.entries(returnedCounts).map(([equipment, outNum]) => ({
        equipment,
        outNum,
      })),
    });
  } catch (err) {
    console.error("Team return error:", err);
    res.json({ success: false, error: err.message });
  }
});

// ================= REGULAR ISSUE =================

// Regular issue endpoint - GET
app.get("/issue", requireStudent, async (req, res) => {
  try {
    const equipmentList = await prisma.equipment.findMany({
      select: {
        name: true,
        inUseQuantity: true,
        _count: {
          select: {
            logs: { where: { status: "pending" } },
          },
        },
      },
    });

    const availableItems = {};
    equipmentList.forEach((row) => {
      availableItems[row.name] = row.inUseQuantity - row._count.logs;
    });

    res.render("issue", {
      student: req.session.student,
      availableItems: availableItems,
      activePage: "issue",
      ...viewUser(req),
    });
  } catch (err) {
    console.error("Error calculating equipment availability:", err);
    return res.status(500).send("Error calculating equipment");
  }
});

// Regular issue endpoint - POST
app.post("/issue", async (req, res) => {
  const currentTime = new Date();
  const quantity = req.body.quantity || {};

  // Get list of equipment to issue (where quantity > 0)
  const equipmentList = Object.keys(quantity).filter(
    (item) => Number(quantity[item]) > 0
  );

  if (equipmentList.length === 0) {
    return res.redirect("/landing");
  }

  try {
    // Get student email
    const student = await prisma.student.findUnique({
      where: { studentID: req.session.student.AshokaId },
      select: { studentEmail: true },
    });

    if (!student) {
      return res.status(500).send("Could not find student email");
    }

    const studentEmail = student.studentEmail;

    // Double-check availability
    const equipmentRows = await prisma.equipment.findMany({
      where: { name: { in: equipmentList } },
      select: {
        equipmentID: true,
        name: true,
        inUseQuantity: true,
        _count: {
          select: {
            logs: { where: { status: "pending" } },
          },
        },
      },
    });

    const availabilityMap = {};
    const equipmentIDMap = {};
    equipmentRows.forEach((row) => {
      availabilityMap[row.name] = row.inUseQuantity - row._count.logs;
      equipmentIDMap[row.name] = row.equipmentID;
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

    // Issue equipment - create log entries
    const dueDate = moment()
      .tz("Asia/Kolkata")
      .add(7, "days")
      .toDate();

    const logCreates = [];
    for (const item of equipmentList) {
      const qtyToIssue = Number(quantity[item]);
      for (let i = 0; i < qtyToIssue; i++) {
        logCreates.push(
          prisma.log.create({
            data: {
              timestamp: currentTime,
              equipmentID: equipmentIDMap[item],
              studentID: req.session.student.AshokaId,
              dueOn: dueDate,
              status: "pending",
            },
          })
        );
      }
    }

    await Promise.all(logCreates);

    // Build issued equipment list
    const issuedEquipment = equipmentList.map((eq) => ({
      equipment: eq,
      outNum: Number(quantity[eq]),
    }));

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
    });

    // Schedule overdue timeouts for newly issued items
    scheduleOverdueForRecentIssues(req.session.student.AshokaId);

    // Render success page with equipment details
    res.render("success", {
      studentName: req.session.student.name,
      equipment: issuedEquipment,
      ...viewUser(req),
      mode: "issued",
    });
  } catch (err) {
    console.error("Error issuing equipment:", err);
    return res.status(500).send("Database error");
  }
});

// ================= TEAM ISSUE =================

app.post("/issue_team_equipment", requireStudent, async (req, res) => {
  const selectedEquipments =
    typeof req.body.equipments === "string"
      ? JSON.parse(req.body.equipments)
      : req.body.equipments;

  const student = req.session.student;

  if (!selectedEquipments || selectedEquipments.length === 0) {
    return res.json({ success: false, error: "No equipment selected" });
  }

  const currentTime = new Date();
  const dueDate = moment()
    .tz("Asia/Kolkata")
    .add(7, "days")
    .toDate();

  try {
    // Fetch student email
    const studentRecord = await prisma.student.findUnique({
      where: { studentID: student.AshokaId },
      select: { studentEmail: true },
    });

    if (!studentRecord) {
      return res
        .status(500)
        .json({ success: false, error: "Student email not found" });
    }

    const studentEmail = studentRecord.studentEmail;

    // Fetch approved sports requests with equipment info
    const requests = await prisma.sportsRequest.findMany({
      where: {
        studentEmail: studentEmail,
        equipment: { name: { in: selectedEquipments } },
        status: "pending",
      },
      include: {
        equipment: { select: { equipmentID: true, name: true } },
      },
    });

    if (requests.length === 0) {
      return res.json({ success: false, error: "No valid requests found" });
    }

    // Insert into Logs item-wise
    for (const reqItem of requests) {
      for (let i = 0; i < reqItem.quantity; i++) {
        await prisma.log.create({
          data: {
            timestamp: currentTime,
            equipmentID: reqItem.equipment.equipmentID,
            studentID: student.AshokaId,
            dueOn: dueDate,
            status: "pending",
            isTeamIssue: true,
          },
        });
      }
    }

    // Mark sports requests as issued
    await prisma.sportsRequest.updateMany({
      where: {
        studentEmail: studentEmail,
        equipment: { name: { in: selectedEquipments } },
        status: "pending",
      },
      data: { status: "issued" },
    });

    // Send team borrow confirmation email
    const equipmentCounts = {};
    requests.forEach((reqItem) => {
      equipmentCounts[reqItem.equipment.name] = reqItem.quantity;
    });

    const issueDate = moment().tz("Asia/Kolkata").format("MMMM D, YYYY");
    const returnDate = moment()
      .tz("Asia/Kolkata")
      .add(7, "days")
      .format("MMMM D, YYYY");

    const teamName = "Sports Team";
    const sportType = selectedEquipments.join(", ");

    await sendTeamBorrowEmail(
      studentEmail,
      student.name,
      teamName,
      sportType,
      equipmentCounts,
      issueDate,
      returnDate
    );

    // Schedule overdue timeouts for newly issued team items
    scheduleOverdueForRecentIssues(student.AshokaId);

    res.render("success", {
      ...viewUser(req),
      studentName: student.name,
      mode: "issued",
      equipment: Object.entries(equipmentCounts).map(([equipment, outNum]) => ({
        equipment,
        outNum,
      })),
    });
  } catch (err) {
    console.error("Team issue error:", err);
    res.status(500).json({ success: false, error: "Team issue failed" });
  }
});

// ================= RETURN LOGIN =================

app.get("/return_login", (req, res) => {
  res.render("return_login", {
    activePage: "landing",
    ...viewUser(req),
  });
});

app.post("/return_login", async (req, res) => {
  const ashokaId = req.body.qrString?.trim();
  try {
    const student = await prisma.student.findUnique({
      where: { studentID: ashokaId },
      select: { studentID: true, studentName: true, studentEmail: true },
    });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    req.session.student = {
      AshokaId: student.studentID,
      name: student.studentName,
      email: student.studentEmail,
    };

    res.redirect("/landing");
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).send("Database error");
  }
});

// ================= LANDING =================

app.get("/landing", requireStudent, (req, res) => {
  res.render("landing_redirect", {
    ashokaId: req.session.student.AshokaId,
    activePage: "landing",
    ...viewUser(req),
  });
});

app.post("/landing", async (req, res) => {
  const ashokaId = String(req.body.qrString).trim();

  try {
    // Fetch student from database
    const student = await prisma.student.findUnique({
      where: { studentID: ashokaId },
      select: { studentID: true, studentName: true, studentEmail: true },
    });

    if (!student) {
      return res.status(404).send("Student not found");
    }

    const studentData = {
      AshokaId: student.studentID,
      name: student.studentName,
      email: student.studentEmail,
    };

    req.session.student = studentData;

    // Fetch pending logs for this student
    const logs = await prisma.log.findMany({
      where: {
        studentID: ashokaId,
        status: "pending",
        isTeamIssue: false,
      },
      include: {
        student: { select: { studentName: true } },
        equipment: { select: { name: true } },
      },
    });

    const results = logs.map((l) => ({
      logID: l.logID,
      studentID: l.studentID,
      studentName: l.student.studentName,
      equipment: l.equipment.name,
      outTime: moment(l.timestamp)
        .tz("Asia/Kolkata")
        .format("ddd DD-MM-YYYY HH:mm:ss"),
      dueOn: moment(l.dueOn)
        .tz("Asia/Kolkata")
        .format("ddd DD-MM-YYYY HH:mm:ss"),
      status: l.status,
      inTime: l.returnedTimestamp,
    }));

    res.render("landing", {
      student: studentData,
      equipment: results,
      ...viewUser(req),
    });
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).send("Database error");
  }
});

// Return equipment rows including inUseQuantity so clients can filter
app.get("/getequipment", async (req, res) => {
  try {
    const rows = await prisma.equipment.findMany({
      select: { name: true, inUseQuantity: true },
    });

    res.json(
      rows.map((r) => ({ equipment: r.name, inUseQuantity: r.inUseQuantity }))
    );
  } catch (err) {
    console.error("Database error fetching equipment:", err);
    return res.status(500).json([]);
  }
});

// ================= RETURN MANY =================

app.post("/returnMany", async (req, res) => {
  if (!req.session.student) {
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  const { returns } = req.body;
  const studentId = req.session.student.AshokaId;
  const returnTime = new Date();

  if (!returns || returns.length === 0) {
    return res.json({ success: false, error: "No items selected" });
  }

  try {
    const damagedUpdates = {};
    const returnedItems = {};

    await prisma.$transaction(async (tx) => {
      for (const returnItem of returns) {
        const { logID, equipment, damaged } = returnItem;

        // Ensure log is valid and pending
        const logEntry = await tx.log.findFirst({
          where: {
            logID: logID,
            studentID: studentId,
            status: "pending",
          },
        });

        if (!logEntry) {
          throw new Error(`Log entry ${logID} not found or already returned`);
        }

        if (logEntry.isTeamIssue) {
          throw new Error("Team-issued equipment cannot be returned via this route");
        }

        // Cancel any scheduled overdue timeout for this item
        cancelOverdueTimeout(logID);

        // Mark log as returned
        await tx.log.update({
          where: { logID: logID },
          data: {
            status: "returned",
            returnedTimestamp: returnTime,
            returnedByID: null,
            damaged: damaged ? true : false,
          },
        });

        // Only damaged items affect inventory counts
        if (damaged) {
          damagedUpdates[equipment] = (damagedUpdates[equipment] || 0) + 1;
        }

        // Track for email
        returnedItems[equipment] = (returnedItems[equipment] || 0) + 1;
      }

      // Reduce usable stock for damaged items
      for (const [equipmentName, qty] of Object.entries(damagedUpdates)) {
        const equip = await tx.equipment.findUnique({
          where: { name: equipmentName },
        });

        if (!equip) {
          throw new Error(`Equipment "${equipmentName}" not found during damaged update`);
        }

        await tx.equipment.update({
          where: { name: equipmentName },
          data: {
            inUseQuantity: { decrement: qty },
            damagedQuantity: { increment: qty },
          },
        });
      }
    });

    // Send return confirmation email (non-blocking)
    try {
      const studentRecord = await prisma.student.findUnique({
        where: { studentID: studentId },
        select: { studentEmail: true, studentName: true },
      });

      if (studentRecord) {
        sendReturnEmail(studentRecord.studentEmail, studentRecord.studentName, returnedItems).catch(
          () => { }
        );
      }
    } catch (_) { }

    res.json({ success: true });
  } catch (err) {
    console.error("Error returning equipment:", err);
    res.json({
      success: false,
      error: "Failed to return equipment: " + err.message,
    });
  }
});

// ================= SPORTS REQUEST =================

app.post("/sports_request", async (req, res) => {
  const {
    studentEmail,
    studentName,
    team,
    equipment: equipmentName,
    quantity,
    startDate,
    endDate,
  } = req.body;

  // Validation
  if (
    !studentEmail ||
    !studentName ||
    !team ||
    !equipmentName ||
    !quantity ||
    !endDate
  ) {
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

  try {
    // Resolve equipment name to ID
    const equip = await prisma.equipment.findUnique({
      where: { name: equipmentName },
      select: { equipmentID: true },
    });

    if (!equip) {
      return res.status(404).json({ success: false, message: "Equipment not found." });
    }

    // Create sports request
    const request = await prisma.sportsRequest.create({
      data: {
        studentEmail,
        team,
        equipmentID: equip.equipmentID,
        quantity: Number(quantity),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: "pending",
      },
    });

    // Update Equipment counts
    await prisma.equipment.update({
      where: { equipmentID: equip.equipmentID },
      data: {
        inUseQuantity: { decrement: Math.min(Number(quantity), (await prisma.equipment.findUnique({ where: { equipmentID: equip.equipmentID } })).inUseQuantity) },
        reservedQuantity: { increment: Number(quantity) },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Sports request submitted successfully",
      requestId: request.requestID,
    });
  } catch (err) {
    console.error("Error inserting sports request:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ================= INVENTORY MANAGEMENT =================

app.post("/update_inventory", async (req, res) => {
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

  try {
    for (const item of inventory) {
      if (item.originalEquipment && item.originalEquipment !== item.equipment) {
        // Handle rename: try update first, then insert if not found
        const existing = await prisma.equipment.findUnique({
          where: { name: item.originalEquipment },
        });

        if (existing) {
          await prisma.equipment.update({
            where: { name: item.originalEquipment },
            data: {
              name: item.equipment,
              totalQuantity: item.totalQuantity,
              reservedQuantity: item.reservedQuantity,
              damagedQuantity: item.damagedQuantity,
              inUseQuantity: item.inUseQuantity,
            },
          });
        } else {
          await prisma.equipment.create({
            data: {
              name: item.equipment,
              totalQuantity: item.totalQuantity,
              reservedQuantity: item.reservedQuantity,
              damagedQuantity: item.damagedQuantity,
              inUseQuantity: item.inUseQuantity,
            },
          });
        }
      } else {
        // Upsert by name
        await prisma.equipment.upsert({
          where: { name: item.equipment },
          update: {
            totalQuantity: item.totalQuantity,
            reservedQuantity: item.reservedQuantity,
            damagedQuantity: item.damagedQuantity,
            inUseQuantity: item.inUseQuantity,
          },
          create: {
            name: item.equipment,
            totalQuantity: item.totalQuantity,
            reservedQuantity: item.reservedQuantity,
            damagedQuantity: item.damagedQuantity,
            inUseQuantity: item.inUseQuantity,
          },
        });
      }
    }

    return res.json({ message: "Inventory updated successfully" });
  } catch (err) {
    console.error("Inventory update error:", err);
    return res.status(500).json({ error: "Database update failed." });
  }
});

// Delete inventory item by equipment name
app.post("/delete_inventory", async (req, res) => {
  const equipment = req.body.equipment;

  if (!equipment || equipment.trim() === "") {
    return res.status(400).json({
      success: false,
      error: "Equipment name required",
    });
  }

  try {
    // Instead of deleting, zero out quantities
    const result = await prisma.equipment.updateMany({
      where: { name: equipment },
      data: {
        totalQuantity: 0,
        reservedQuantity: 0,
        damagedQuantity: 0,
        inUseQuantity: 0,
      },
    });

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        error: "Equipment not found",
      });
    }

    return res.json({
      success: true,
      message: "Equipment inventory cleared successfully",
    });
  } catch (err) {
    console.error("Error zeroing equipment:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ================= OFFENCES =================

app.get("/get_offences", ensureAuthenticated, async (req, res) => {
  try {
    const results = await prisma.$queryRaw`
      SELECT s.studentName, s.studentEmail, COUNT(l.logID) as offences
      FROM Students s
      JOIN Logs l ON s.studentID = l.studentID
      WHERE l.status IN ('overdue', 'overdue_returned')
      GROUP BY s.studentID
      ORDER BY offences DESC
    `;

    res.json(results.map(r => ({
      studentName: r.studentName,
      studentEmail: r.studentEmail,
      offences: Number(r.offences),
    })));
  } catch (err) {
    console.error("Error fetching offences:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

app.get("/team_landing", requireStudent, (req, res) => {
  res.render("team_landing", {
    activePage: "team-landing",
    ...viewUser(req),
  });
});

// ================= ADMIN =================

app.get("/admin", ensureAdmin, async (req, res) => {
  try {
    const results = await prisma.equipment.findMany();

    const equipmentData = results.map((row) => ({
      equipment: row.name,
      totalQuantity: row.totalQuantity,
      reservedQuantity: row.reservedQuantity,
      damagedQuantity: row.damagedQuantity,
      inUseQuantity: row.inUseQuantity,
    }));

    // console.log("Equipment Data:", equipmentData);

    res.render("admin", {
      activePage: "admin",
      ...viewUser(req),
      equipment: equipmentData,
    });
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).send("Database error");
  }
});

// ================= STATISTICS API =================

app.get("/api/statistics", ensureAdmin, async (req, res) => {
  try {
    const period = req.query.period || "today";

    // Determine date filter based on period
    const now = moment().tz("Asia/Kolkata");
    let dateFrom = null;

    switch (period) {
      case "today":
        dateFrom = now.clone().startOf("day").toDate();
        break;
      case "week":
        dateFrom = now.clone().startOf("week").toDate();
        break;
      case "month":
        dateFrom = now.clone().startOf("month").toDate();
        break;
      case "all":
      default:
        dateFrom = null;
        break;
    }

    // console.log(`[Statistics] Fetching data for period: ${period}`);

    const dateCondition = dateFrom ? { gte: dateFrom } : undefined;

    // Total checkouts
    const totalCheckouts = await prisma.log.count({
      where: dateFrom ? { timestamp: dateCondition } : {},
    });

    // Total returns
    const totalReturns = await prisma.log.count({
      where: {
        status: { in: ["returned", "overdue_returned"] },
        ...(dateFrom ? { returnedTimestamp: dateCondition } : {}),
      },
    });

    // Active users (unique borrowers)
    const activeUsersResult = await prisma.log.findMany({
      where: dateFrom ? { timestamp: dateCondition } : {},
      distinct: ["studentID"],
      select: { studentID: true },
    });
    const activeUsers = activeUsersResult.length;

    // Pending returns (currently checked out)
    const pendingReturns = await prisma.log.count({
      where: { status: { in: ["pending", "overdue"] } },
    });

    // Most borrowed equipment
    const mostBorrowed = await prisma.$queryRaw(Prisma.sql`
      SELECT e.name as equipment, COUNT(*) as count 
      FROM Logs l
      JOIN Equipment e ON l.equipmentID = e.equipmentID
      ${dateFrom ? Prisma.sql`WHERE l.timestamp >= ${dateFrom}` : Prisma.empty}
      GROUP BY e.name
      ORDER BY count DESC 
      LIMIT 10
    `);

    // Most active borrowers
    const activeBorrowers = await prisma.$queryRaw(Prisma.sql`
      SELECT s.studentName as name, s.studentID as ashokaId, COUNT(*) as count 
      FROM Logs l
      JOIN Students s ON l.studentID = s.studentID
      ${dateFrom ? Prisma.sql`WHERE l.timestamp >= ${dateFrom}` : Prisma.empty}
      GROUP BY s.studentID, s.studentName
      ORDER BY count DESC 
      LIMIT 10
    `);

    // Equipment currently checked out with availability
    const equipmentOut = await prisma.equipment.findMany({
      where: { inUseQuantity: { gt: 0 } },
      select: {
        name: true,
        totalQuantity: true,
        inUseQuantity: true,
        reservedQuantity: true,
        damagedQuantity: true,
      },
      orderBy: { inUseQuantity: "desc" },
    });

    const response = {
      totalCheckouts: totalCheckouts || 0,
      totalReturns: totalReturns || 0,
      activeUsers: activeUsers || 0,
      pendingReturns: pendingReturns || 0,
      mostBorrowed: (mostBorrowed || []).map(r => ({ equipment: r.equipment, count: Number(r.count) })),
      activeBorrowers: (activeBorrowers || []).map(r => ({ name: r.name, ashokaId: r.ashokaId, count: Number(r.count) })),
      equipmentOut: equipmentOut.map(e => ({
        equipment: e.name,
        total: e.totalQuantity,
        inUse: e.inUseQuantity,
        available: e.totalQuantity - e.reservedQuantity - e.damagedQuantity - e.inUseQuantity,
      })),
    };

    // console.log(`[Statistics] Response:`, JSON.stringify(response, null, 2));
    res.json(response);
  } catch (error) {
    console.error("Error fetching statistics:", error);
    console.error("Stack trace:", error.stack);
    res.status(500).json({
      error: "Failed to fetch statistics",
      message: error.message
    });
  }
});

app.get("/statistics", ensureAdmin, (req, res) => {
  res.render("dashboard", {
    activePage: "statistics",
    ...viewUser(req),
  });
});

// ================= WEBHOOK =================

app.post("/api/check-overdue", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.WEBHOOK_API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  try {
    const result = await checkAndMarkOverdueItems();
    res.json(result);
  } catch (error) {
    console.error("Webhook overdue check error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ================= SUCCESS PAGES =================

// Store success data in session for later retrieval
app.post("/store-success-data", (req, res) => {
  console.log("POST /store-success-data called");
  console.log("Student session:", req.session.student);

  if (!req.session.student) {
    console.log("Error: No student session");
    return res.status(401).json({ success: false, error: "Not logged in" });
  }

  req.session.successData = {
    issuedEquipment: req.body.issuedEquipment,
    name: req.body.name,
    mode: req.body.mode,
  };

  console.log("Success data stored:", req.session.successData);
  res.json({ success: true });
});

// Render success page from stored session data
app.get("/show-success", (req, res) => {
  console.log("GET /show-success called");
  console.log("Student session:", req.session.student);
  console.log("Success data:", req.session.successData);

  if (!req.session.student || !req.session.successData) {
    console.log("Redirecting to /landing - missing student or successData");
    return res.redirect("/landing");
  }

  const { issuedEquipment, name, mode } = req.session.successData;
  const equipmentArray = issuedEquipment || [];

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

  // Clear the success data from session after use
  delete req.session.successData;

  console.log("Rendering success page with:", {
    name,
    mode,
    equipment: groupedArray,
  });

  res.render("success", {
    ...viewUser(req),
    studentName: name || "Unknown",
    mode: mode || "returned",
    equipment: groupedArray,
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
    ...viewUser(req),
    studentName: req.body.name || "Unknown",
    mode: req.body.mode || "processed",
    equipment: groupedArray,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);

  // Format threshold for display
  const thresholdDisplay = OVERDUE_THRESHOLD_MINUTES < 60
    ? `${OVERDUE_THRESHOLD_MINUTES} minutes`
    : `${OVERDUE_THRESHOLD_HOURS} hours (${OVERDUE_THRESHOLD_MINUTES} minutes)`;
  console.log(`⏰ Overdue threshold: ${thresholdDisplay}`);

  // Reschedule overdue timeouts for pending items on startup
  setTimeout(async () => {
    logToFile("🚀 Server started - rescheduling overdue timeouts...");
    await rescheduleAllOverdueTimeouts();
  }, 3000); // Wait 3 seconds for DB connection to stabilize
});
