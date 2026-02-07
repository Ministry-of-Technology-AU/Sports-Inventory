# Sports Inventory

<h2>View #1: Guard side | while issuing equipment </h2>
As shown below, the guard can scan the student's ashokaID and then log the student into the system. <br>
The name and ashokaID will be displayed on the left side <br> <br>
<img width="1708" alt="Screenshot 2025-02-19 at 12 22 14 AM" src="https://github.com/user-attachments/assets/e7c4b537-248a-4e8c-b56d-344e6f67e497" /> <br> <br>
They can now select the equipment that is to be issued along with the quantity to be issued and a summary will be provided of all the selected equipment along with their quantities  <br> <br>
<img width="1709" alt="Screenshot 2025-02-19 at 12 27 50 AM" src="https://github.com/user-attachments/assets/aa5a020d-15a8-4ea4-9898-6526819554ed" /><br> <br>

On clicking on issue the equipment will be issued <br> <br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 28 39 AM" src="https://github.com/user-attachments/assets/bb2768af-8e91-4a3c-b292-79a45252c144" /> <br> <br>
A success page will be rendered along with the students name <br> <br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 24 30 AM" src="https://github.com/user-attachments/assets/63734603-9d8b-458c-9c40-2da8164fb969" /> <br> <br>
<br>

<h2>View #2: Guard side | while accepting the returning equipment </h2>
After the logging in the student similarly to the issuing process, as shown below, the guard will be able to see the receiver's outstanding equipment with each unit item in a separate row along with the option to mark as returned. <br><br>
<img width="1710" alt="Screenshot 2025-02-19 at 12 30 44 AM" src="https://github.com/user-attachments/assets/3a8bec5b-c573-4d3c-b856-004c84aec5ee" /> <br>  <br>
On selecting the packages to be given, or selecing the checkbox at the column header, and clicking 'Return Selected', the equipment will be successfully returned. A sucess page will be rendered <br><br>

<h2>View #3: Sports Request Creation </h2>

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
