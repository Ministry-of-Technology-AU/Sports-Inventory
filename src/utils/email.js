import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { logToFile } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

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
  path.join(__dirname, "../../templates/borrow.html"),
  "utf-8"
);
const RETURN_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../../templates/return.html"),
  "utf-8"
);
const OVERDUE_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../../templates/overdue.html"),
  "utf-8"
);
const TEAM_BORROW_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../../templates/team-borrow.html"),
  "utf-8"
);
const TEAM_RETURN_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../../templates/team-return.html"),
  "utf-8"
);
const TEAM_OVERDUE_TEMPLATE = fs.readFileSync(
  path.join(__dirname, "../../templates/team-overdue.html"),
  "utf-8"
);

/**
 * Send borrow confirmation email
 * @param {string} studentEmail - Student's email address
 * @param {string} studentName - Student's name
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 */
export async function sendBorrowEmail(studentEmail, studentName, equipmentCounts) {
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
export async function sendReturnEmail(studentEmail, studentName, equipmentCounts) {
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
export async function sendOverdueEmail(
  studentEmail,
  studentName,
  equipmentCounts,
  equipmentName
) {
  try {
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // HARDCODED IMAGE IF–ELSE
    // ---------------- IMAGE SELECTION (HARDCODED) ----------------

    let equipmentImagePath =
      "https://drive.google.com/uc?export=view&id=10W82tiSEfcINQEy6AAe2jAcBoGGcpyIR"; // general

    if (equipmentName === "Badminton Racquet") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1mJcg3_qUtke7iz9iya5SG-OjvdDpkY0K";
    } else if (equipmentName === "Basketball") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1TrnTTw-rCgoyFkTV7HzaIBs_dIR5FHL6";
    } else if (equipmentName === "Boxing Gloves") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1CYAP4Tx-zrj7ipuTjxRjtpvDn4vAvieg";
    } else if (
      equipmentName === "Cricket Bat" ||
      equipmentName === "Cricket Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1cJqY8Pfli5oJEcvuBptTmSubFhNo8pws";
    } else if (equipmentName === "Cycle") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1DDy9kjcNDp51V1hXFe21dlPKIh0Ih7Zq";
    } else if (equipmentName === "Foosball") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1dOPtDcBbOMrohMzi14wn725z3HyQRQEd";
    } else if (equipmentName === "Football") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1IGvOHd627ujDZogrenAUmYuOZV6yKRPY";
    } else if (equipmentName === "Frisbee") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1uaG2Um75NRF13Xk3i6bOxGAkx-QNQPpx";
    } else if (
      equipmentName === "Pickleball Racquet" ||
      equipmentName === "Pickleball Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1oOdOcaQunEyE_medViokQfMRgKXhkEjK";
    } else if (equipmentName === "Pool Stick") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=11tlNWOifsVCoivKdDsf6_VoR6MsE7H35";
    } else if (
      equipmentName === "Squash Racquet" ||
      equipmentName === "Squash Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1XYdjJkYnfGBxaVFnuZR2kqrbHQAAu_Dd";
    } else if (
      equipmentName === "Tennis Racquet" ||
      equipmentName === "Tennis Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=12H1lzn4c46xdejtOz3UvrKcksHjrMUpt";
    } else if (
      equipmentName === "Table Tennis Racquet" ||
      equipmentName === "Table Tennis Ball"
    ) {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1zXgG2StDcAg91CmKGbb000-1yw3SvlPr";
    } else if (equipmentName === "Volleyball") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1mQra8FmIARyQ0pObY_Nj_q05yQbH6RFD";
    } else if (equipmentName === "Yoga Mat") {
      equipmentImagePath =
        "https://drive.google.com/uc?export=view&id=1Y9IpuNpn6_li9xsWnGNnUW3FvumusS1h";
    }

    // -------------------------------------------------------------

    const emailHtml = OVERDUE_TEMPLATE.replace(/{{name}}/g, studentName)
      .replace(/{{pendingEquipment}}/g, equipmentList)
      .replace(/{{equipmentImage}}/g, equipmentImagePath);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: studentEmail,
      subject: "⚠️ Sports Equipment Overdue - Return Required",
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(`📧 Overdue email sent to ${studentEmail} for ${equipmentName}`);
    return { success: true };
  } catch (error) {
    logToFile(
      `❌ Failed to send overdue email to ${studentEmail}: ${error.message}`
    );
    return { success: false };
  }
}

/**
 * Send team borrow confirmation email
 * @param {string} captainEmail - Team captain's email address
 * @param {string} captainName - Team captain's name
 * @param {string} teamName - Team name
 * @param {string} sportType - Sport type
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 * @param {string} issueDate - Date equipment was issued
 * @param {string} returnDate - Expected return date
 */
export async function sendTeamBorrowEmail(
  captainEmail,
  captainName,
  teamName,
  sportType,
  equipmentCounts,
  issueDate,
  returnDate
) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = TEAM_BORROW_TEMPLATE.replace(
      /{{captainName}}/g,
      captainName
    )
      .replace(/{{teamName}}/g, teamName)
      .replace(/{{sportType}}/g, sportType)
      .replace(/{{borrowedEquipment}}/g, equipmentList)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{returnDate}}/g, returnDate);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: captainEmail,
      subject: `Team Equipment Borrowed - ${teamName}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Team borrow email sent to ${captainEmail} (${teamName}) - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send team borrow email to ${captainEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send team return confirmation email
 * @param {string} captainEmail - Team captain's email address
 * @param {string} captainName - Team captain's name
 * @param {string} teamName - Team name
 * @param {string} sportType - Sport type
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 * @param {string} issueDate - Original issue date
 * @param {string} returnDate - Date equipment was returned
 * @param {string} equipmentStatus - Status message (e.g., "All equipment in good condition")
 */
export async function sendTeamReturnEmail(
  captainEmail,
  captainName,
  teamName,
  sportType,
  equipmentCounts,
  issueDate,
  returnDate,
  equipmentStatus
) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = TEAM_RETURN_TEMPLATE.replace(
      /{{captainName}}/g,
      captainName
    )
      .replace(/{{teamName}}/g, teamName)
      .replace(/{{sportType}}/g, sportType)
      .replace(/{{returnedEquipment}}/g, equipmentList)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{returnDate}}/g, returnDate)
      .replace(/{{equipmentStatus}}/g, equipmentStatus);

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: captainEmail,
      subject: `Team Equipment Returned - ${teamName}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Team return email sent to ${captainEmail} (${teamName}) - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send team return email to ${captainEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}

/**
 * Send team overdue equipment reminder email
 * @param {string} captainEmail - Team captain's email address
 * @param {string} captainName - Team captain's name
 * @param {string} teamName - Team name
 * @param {string} sportType - Sport type
 * @param {object} equipmentCounts - Object mapping equipment name to quantity
 * @param {string} issueDate - Original issue date
 * @param {string} returnDate - Expected return date
 * @param {number} daysOverdue - Number of days overdue
 */
export async function sendTeamOverdueEmail(
  captainEmail,
  captainName,
  teamName,
  sportType,
  equipmentCounts,
  issueDate,
  returnDate,
  daysOverdue
) {
  try {
    // Format equipment list with each item on a new line
    const equipmentList = Object.entries(equipmentCounts)
      .map(([equipment, qty]) => `${equipment} - ${qty}`)
      .join("<br>");

    // Replace placeholders in template
    const emailHtml = TEAM_OVERDUE_TEMPLATE.replace(
      /{{captainName}}/g,
      captainName
    )
      .replace(/{{teamName}}/g, teamName)
      .replace(/{{sportType}}/g, sportType)
      .replace(/{{pendingEquipment}}/g, equipmentList)
      .replace(/{{issueDate}}/g, issueDate)
      .replace(/{{returnDate}}/g, returnDate)
      .replace(/{{daysOverdue}}/g, daysOverdue.toString());

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: captainEmail,
      subject: `⚠️ URGENT: Team Equipment Overdue - ${teamName}`,
      html: emailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    logToFile(
      `📧 Team overdue email sent to ${captainEmail} (${teamName}) - MessageID: ${info.messageId}`
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logToFile(
      `❌ Failed to send team overdue email to ${captainEmail}: ${error.message}`
    );
    return { success: false, error: error.message };
  }
}
