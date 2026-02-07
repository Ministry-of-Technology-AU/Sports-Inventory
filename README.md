# Sports Inventory

<h2>View #1: Guard side | while issuing equipment </h2>
As shown below, the guard can scan the student's ashokaID and then log the student into the system. <br>
The name and ashokaID will be displayed on the left side <br> <br>
<img width="1708" alt="Screenshot 2025-02-19 at 12 22 14 AM" src="./images/Screenshot 2026-02-07 115710.png" /> <br> <br>
They can now select the equipment that is to be issued along with the quantity to be issued and a summary will be provided of all the selected equipment along with their quantities  <br> <br>
<img width="1709" alt="Screenshot 2025-02-19 at 12 27 50 AM" src="./images/Screenshot 2026-02-07 120158.png" /><br> <br>

On clicking on issue the equipment will be issued <br>
A success page will be rendered along with the students name <br> <br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 24 30 AM" src="./images/Screenshot 2026-02-07 120402.png" /> <br> <br>
<br>

<h2>View #2: Guard side | while accepting the returning equipment </h2>
After the logging in the student similarly to the issuing process, as shown below, the guard will be able to see the receiver's outstanding equipment with each unit item in a separate row along with the option to mark as returned. <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 120546.png" /> <br>  <br>
On selecting the packages to be given, or selecing the checkbox at the column header, and clicking 'Return Selected', the equipment will be successfully returned. A sucess page will be rendered <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 120705.png" /> <br>  <br>

<h2>View #3: Inventory Status and Update Inventory</h2>
As shown below, the inventory can be updated through adding new rows abd updating the exisiting values. There is also a button in each row to delete that specfific inventory item. <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 120751.png" /> <br>  <br>

<h2>View #4: Sports Request Creation </h2>
As shown below, the sports request form that can be used to authorise a student for accessing a specific sports team request and return portal <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 121446.png" /> <br>  <br>

<h2>View #5: Statistics Dashboard </h2>
As shown below, the statistics dashboard can be used to obtain real-time data analytics regarding the  <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 122209.png" /> <br>  <br>

<h2>View #6: Student Offences </h2>
As shown below, the offences done by students can be shown in the offences section of the admin page. <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 122407.png" /> <br>  <br>

<h2>View #7: Damaged Equipment </h2>
As shown below, the equipment that has been returned marked as damaged can be viewed in the damaged equipment section of the admin page<br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="./images/Screenshot 2026-02-07 122621.png" /> <br>  <br>

<h2>Setup and dependencies: </2><br>
<h5>How to setup: </h5>
1. Configure mySQL locally <br>
2. Set credentials in .env according to the mySQL credentials <br>
3. Open the terminal and type mysql -u root -p <br>
4. Type in your password <br>
5. CREATE DATABASE SportsInventory; <br>
6. USE DATABASE SportsInventory; <br>
7. Create 5 tables using the table creation commands. <br>
8. Your mySQL setup is ready! <br>
9. Clone the repo. <br>
10. Run node src/App.js in your terminal. <br>
11. The system should run for you locally and all logs should be visible in your mySQL database. <br>
12. To view the logs, login to mySQL through the terminal as done in 3. and 4. and enter 'SELECT * FROM Logs;'<br>

<h6>Ejs (Express javascript): Frontend <br>
Node.js: Backend <br>
MySQL: Database</h6>
1. mysql  Ver 14.14 <br>
2. node v16.20.2 <br>
3. "ejs": "^3.1.10" <br>
4. "fuse": "^0.12.1" <br>
5. "fuse.js": "^7.1.0" <br>
6. "tailwind": "^4.0.0" <br>

<h2>Packages: Table structure</h2> <br>
CREATE TABLE Equipment (
equipment VARCHAR(100) UNIQUE PRIMARY KEY,
totalQuantity INT NOT NULL,
reservedQuantity INT NOT NULL,
damagedQuantity INT NOT NULL,
inUseQuantity INT NOT NULL
);

CREATE TABLE Students (
studentID VARCHAR(50) PRIMARY KEY,
studentName VARCHAR(100) NOT NULL,
studentEmail VARCHAR(100) UNIQUE NOT NULL,

    borrowedNotOutstanding INT DEFAULT 0,
    borrowedOutstanding INT DEFAULT 0,
    offences INT DEFAULT 0,
    sportsTeamAuthorised BOOLEAN DEFAULT FALSE

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
overdue BOOLEAN NOT NULL DEFAULT FALSE,
overdueEmailSent BOOLEAN NOT NULL DEFAULT FALSE,
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

<!-- DATA INSERTION FOR TESTING -->

INSERT INTO Equipment
(equipment, totalQuantity, reservedQuantity, damagedQuantity, inUseQuantity)
VALUES
('Basketball', 50, 10, 2, 15),
('Football', 40, 5, 1, 12),
('Badminton Racket', 30, 8, 3, 10),
('Hockey Stick', 25, 6, 2, 9),
('Cricket Bat', 35, 12, 4, 14);

INSERT INTO students (studentID, studentName, studentEmail)
VALUES
("1020251823", "Atharvajeet Singh", "atharvajeet.singh_ug2025@ashoka.edu.in")
("1020251110", "Aditya Kanodia", "aditya.kanodia_ug2025@ashoka.edu.in")

<br>

# Instructions

To get started with running the code in the server, do the following:

## Deployment

Clone the project

```bash
  git clone https://github.com/Ministry-of-Technology-AU/Sports-Inventory.git
```

Go to the project directory

```bash
  cd sports-inventory
```

Install dependencies

```bash
  npm install
```

and

```bash
  npm install -g nodemon # or using yarn: yarn global add nodemon
```

Start the app

```bash
  nodemon src/app.js
```

## To manage the app using PM2

```bash
  pm2 start npm --name "sports-inventory" -- start
```
