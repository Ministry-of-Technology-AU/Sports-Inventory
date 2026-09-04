-- Normalized schema for Sports Inventory

CREATE TABLE Equipment (
    equipmentID INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    totalQuantity INT NOT NULL,
    reservedQuantity INT NOT NULL DEFAULT 0,
    damagedQuantity INT NOT NULL DEFAULT 0,
    inUseQuantity INT NOT NULL DEFAULT 0
);

CREATE TABLE Students (
    studentID VARCHAR(50) PRIMARY KEY,
    studentName VARCHAR(100) NOT NULL,
    studentEmail VARCHAR(100) UNIQUE NOT NULL,
    sportsTeamAuthorised BOOLEAN DEFAULT FALSE
);my

CREATE TABLE SportsRequests (
    requestID INT AUTO_INCREMENT PRIMARY KEY,
    studentEmail VARCHAR(100) NOT NULL,
    team VARCHAR(20) DEFAULT NULL,
    equipmentID INT NOT NULL,
    quantity INT NOT NULL,
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    approvedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'issued', 'returned') DEFAULT 'pending',
    
    CONSTRAINT fk_request_student_email FOREIGN KEY (studentEmail)
        REFERENCES Students(studentEmail),
    CONSTRAINT fk_request_equipment_id FOREIGN KEY (equipmentID)
        REFERENCES Equipment(equipmentID)
);

CREATE TABLE Logs (
    logID INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    equipmentID INT NOT NULL,
    studentID VARCHAR(50) NOT NULL,
    dueOn DATETIME NOT NULL,
    status ENUM('pending', 'returned', 'overdue', 'overdue_returned') DEFAULT 'pending',
    overdueEmailSent BOOLEAN NOT NULL DEFAULT FALSE,
    returnedTimestamp DATETIME,
    returnedByID VARCHAR(50) NULL,
    damaged BOOLEAN DEFAULT FALSE,
    isTeamIssue BOOLEAN NOT NULL DEFAULT FALSE,
    
    CONSTRAINT fk_logs_equipment_id FOREIGN KEY (equipmentID) 
        REFERENCES Equipment(equipmentID),
    CONSTRAINT fk_logs_student_id FOREIGN KEY (studentID) 
        REFERENCES Students(studentID),
    CONSTRAINT fk_logs_returned_by_id FOREIGN KEY (returnedByID) 
        REFERENCES Students(studentID) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE,
    
    INDEX idx_student_status (studentID, status),
    INDEX idx_equipment_status (equipmentID, status)
);

CREATE TABLE EquipmentLogs (
    logID INT AUTO_INCREMENT PRIMARY KEY,
    equipmentID INT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    totalStockAsOfTimestamp INT NOT NULL,
    updateDone VARCHAR(255),
    
    CONSTRAINT fk_equipment_logs_id FOREIGN KEY (equipmentID)
        REFERENCES Equipment(equipmentID)
);

-- DATA INSERTION FOR TESTING

INSERT INTO Equipment
(name, totalQuantity, reservedQuantity, damagedQuantity, inUseQuantity)
VALUES
('Basketball', 50, 10, 2, 15),
('Football', 40, 5, 1, 12),
('Badminton Racket', 30, 8, 3, 10),
('Hockey Stick', 25, 6, 2, 9),
('Cricket Bat', 35, 12, 4, 14);

INSERT INTO Students (studentID, studentName, studentEmail) 
VALUES 
('1020251823', 'Atharvajeet Singh', 'atharvajeet.singh_ug2025@ashoka.edu.in'),
('1020251110', 'Aditya Kanodia', 'aditya.kanodia_ug2025@ashoka.edu.in'),
('1020251390', 'Nitin S', 'nitin.s_ug2025@ashoka.edu.in');