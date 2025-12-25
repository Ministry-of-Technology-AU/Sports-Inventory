CREATE TABLE Equipment (
equipment VARCHAR(100) UNIQUE PRIMARY KEY,
totalQuantity INT NOT NULL,
reservedQuantity INT NOT NULL,
damagedQuantity INT NOT NULL,
inUseQuantity INT NOT NULL
);

data insertion:

INSERT INTO Equipment
(equipment, totalQuantity, reservedQuantity, damagedQuantity, inUseQuantity)
VALUES
('Basketball', 50, 10, 2, 15),
('Football', 40, 5, 1, 12),
('Badminton Racket', 30, 8, 3, 10),
('Hockey Stick', 25, 6, 2, 9),
('Cricket Bat', 35, 12, 4, 14);

CREATE TABLE Students (
studentID VARCHAR(50) PRIMARY KEY,
studentName VARCHAR(100) NOT NULL,
studentEmail VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE SportsRequests (
studentEmail VARCHAR(100),
studentName VARCHAR(100),
team VARCHAR(20) DEFAULT NULL,
equipment VARCHAR(100),
quantity INT NOT NULL,
startDate DATE NOT NULL,
endDate DATE NOT NULL,
approvedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
issued BOOLEAN DEFAULT FALSE,
returned BOOLEAN DEFAULT FALSE,

    CONSTRAINT fk_student_email FOREIGN KEY (studentEmail)
        REFERENCES Students(studentEmail),

    CONSTRAINT fk_equipment FOREIGN KEY (equipment)
        REFERENCES Equipment(equipment)

);

-- Create Logs table
CREATE TABLE Logs (
logID INT AUTO_INCREMENT PRIMARY KEY,
timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
equipmentBorrowed VARCHAR(100) NOT NULL,
studentID VARCHAR(50) NOT NULL,
studentEmail VARCHAR(100) NOT NULL,
studentName VARCHAR(100) NOT NULL,
dueOn DATETIME NOT NULL,
pending BOOLEAN NOT NULL DEFAULT TRUE,
returned BOOLEAN NOT NULL DEFAULT FALSE,
returnedTimestamp DATETIME,
returnedByID VARCHAR(50) NULL,
returnedByEmail VARCHAR(100) NULL,
damaged ENUM('Yes', 'No') DEFAULT 'No',
isTeamIssue BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT fk_logs_equipment FOREIGN KEY (equipmentBorrowed)
        REFERENCES Equipment(equipment),

    CONSTRAINT fk_logs_student_id FOREIGN KEY (studentID)
        REFERENCES Students(studentID),

    CONSTRAINT fk_logs_student_email FOREIGN KEY (studentEmail)
        REFERENCES Students(studentEmail),

    CONSTRAINT fk_logs_returned_by_id FOREIGN KEY (returnedByID)
        REFERENCES Students(studentID)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_logs_returned_by_email FOREIGN KEY (returnedByEmail)
        REFERENCES Students(studentEmail)
        ON DELETE SET NULL
        ON UPDATE CASCADE

);

-- Create EquipmentLogs table
CREATE TABLE EquipmentLogs (
logID INT AUTO_INCREMENT PRIMARY KEY,
itemName VARCHAR(100) NOT NULL,
timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
totalStockAsOfTimestamp INT NOT NULL,
updateDone VARCHAR(255),

    CONSTRAINT fk_equipment_logs_item FOREIGN KEY (itemName)
        REFERENCES Equipment(equipment)

);

-- Alter Students table to add new columns
ALTER TABLE Students
ADD COLUMN borrowedNotOutstanding INT DEFAULT 0,
ADD COLUMN borrowedOutstanding INT DEFAULT 0,
ADD COLUMN offences INT DEFAULT 0,
ADD COLUMN sportsTeamAuthorised BOOLEAN DEFAULT FALSE;

INSERT INTO SportsRequests (studentEmail, studentName, equipment, quantity, startDate, endDate, approvedOn, issued)
VALUES
('vaani.goenka_ug2024@ashoka.edu.in', 'Vaani Goenka', 'Badminton Racket', 1, '2025-11-15', '2025-12-15', CURRENT_TIMESTAMP, 0),
('vaani.goenka_ug2024@ashoka.edu.in', 'Vaani Goenka', 'Basketball', 2, '2025-11-15', '2025-12-15', CURRENT_TIMESTAMP, 0),
('vaani.goenka_ug2024@ashoka.edu.in', 'Vaani Goenka', 'Football', 1, '2025-11-15', '2025-12-15', CURRENT_TIMESTAMP, 0);
