# Mailroom-Project
<h2>View #1: Guard side | while logging the package </h2>
As shown below, the guard can type in a few letters of the name displayed on the package (or the student's ashokaID) and then select the student from the dropdown. <br>
For students having same names, guards can verify the ashoka ID displayed on the right side in the dropdown. <br> <br>
<img width="1708" alt="Screenshot 2025-02-19 at 12 22 14 AM" src="https://github.com/user-attachments/assets/e7c4b537-248a-4e8c-b56d-344e6f67e497" /> <br> <br>
After selecting the student, they select the delivery service as shown below. <br> <br>
<img width="1709" alt="Screenshot 2025-02-19 at 12 27 50 AM" src="https://github.com/user-attachments/assets/aa5a020d-15a8-4ea4-9898-6526819554ed" /><br> <br>

In case the package does not have details (or enough details), the guard may click on 'No User Found'. <br> <br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 28 39 AM" src="https://github.com/user-attachments/assets/bb2768af-8e91-4a3c-b292-79a45252c144" /> <br> <br>
This takes them to a page to enter the tracking ID of the package instead. <br> <br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 24 30 AM" src="https://github.com/user-attachments/assets/63734603-9d8b-458c-9c40-2da8164fb969" /> <br> <br>
<br>
In both the above cases, the guard selects the delivery partner per usual and logs the package. A success page is rendered with the following specifications: <br>
1. Package No. : This is generated serially. For example, the 16th package of the day has PackageNo. = 16. (This is how their current system works as well) <br>
2. Shelf No. : This is generated based on the first letter of the student's name. For example, for Ibrahim, it is I. (This is how their current system works as well) <br>
3. Timestamp: Shows them the current date and time. They write the day and month on the package for logging purposes. <br>

<h2>View #2: Guard side | while giving packages to the receiver </h2>
As shown below, the guard will be able to see the receiver's outstanding packages on scanning their Ashoka QR code (or relevant logging mechanism). <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="https://github.com/user-attachments/assets/3a8bec5b-c573-4d3c-b856-004c84aec5ee" /> <br>  <br>
On selecting the packages to be given, or selecing 'All', and clicking 'Checkout', the guard will successfully mark these packages as 'received'. (Previously, by default, the 'status' of these packages is marked as 'pending'). Consequently, a relevant success page is shown. <br><br>

<h2>Working of the application in brief </h2>
We use cached student data to perform search in the backend to display search results. On selecting the student and delivery partner, we generate a packageNo., shelfNo. and timestamp as outlined above. Then, we store the record in an SQL database. While showing packages, we query with either the ashoka ID or the tracking ID (every package must have either ashoka ID or tracking ID and never both), and display the results. Once checked out, we change the status of the packages from 'pending' to 'received' in the database. This is for maintaining logs and making reports as required.

<h2>Setup and dependencies: </2><br>
<h5>How to setup: </h5>
1. Configure mySQL locally <br>
2. Set credentials in .env according to the mySQL credentials <br>
3. Open the terminal and type mysql -u root -p <br>
4. Type in your password <br>
5. CREATE DATABASE Packages (or Mailroom); <br>
6. USE DATABASE Packages (or Mailroom); <br>
7. Create a table with the code given at the end. <br>
8. Your mySQL setup is ready! <br>
9. Clone the repo. <br>
10. Run node src/App.js in your terminal. <br>
11. The system should run for you locally and all logs should be visible in your mySQL database. <br>
12. To view the logs, login to mySQL through the terminal as done in 3. and 4. and enter 'SELECT * FROM Packages;'<br>

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
CREATE TABLE packages (
  ashokaID varchar(20) DEFAULT NULL,
  trackingID varchar(30) DEFAULT NULL,
  packageNo int NOT NULL,
  shelfNo varchar(20) NOT NULL,
  timestamp text NOT NULL,
  deliveryPartner text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending',
  remarks text DEFAULT NULL,
  collectedBy varchar(50) DEFAULT NULL,
  collectedAt text DEFAULT NULL,
  CONSTRAINT packages_chk_1 CHECK ((ashokaID IS NOT NULL OR trackingID IS NOT NULL)),
  CONSTRAINT packages_chk_2 CHECK (status IN ('pending', 'received'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


<br>
