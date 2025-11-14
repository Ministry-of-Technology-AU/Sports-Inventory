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
    equipment VARCHAR(100),
    quantity INT NOT NULL,
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    approvedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_student_email FOREIGN KEY (studentEmail)
        REFERENCES Students(studentEmail),

    CONSTRAINT fk_equipment FOREIGN KEY (equipment)
        REFERENCES Equipment(equipment)
);