# AU Sports Inventory

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

## Setup and Dependencies

### Prerequisites
- [Node.js](https://nodejs.org/) (v22.15.0+)
- [MySQL](https://www.mysql.com/) database

This repository declares `node >=22.15.0` in `package.json`, so older versions will trigger an `EBADENGINE` warning during `npm install`.

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Ministry-of-Technology-AU/Sports-Inventory.git
   cd AU-Sports-Inventory
   ```

2. **Configure Environment Variables**
   Create a `.env` file in the root directory and add the following:
   ```env
   # Database Configuration
   DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
   
   # Server Configuration
   PORT=3000
   SECRET_KEY="your_session_secret"
   
   # Google OAuth Configuration
   GOOGLE_CLIENT_ID="your_client_id"
   GOOGLE_CLIENT_SECRET="your_client_secret"
   GOOGLE_CALLBACK_URL="http://localhost:3000/auth/google/callback"
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Initialize Database**
   Instead of running manual SQL scripts, use Prisma to sync the schema:
   ```bash
   npx prisma push
   npx prisma generate
   ```

5. **Start the application**
   ```bash
   # Development mode with nodemon
   npm run dev 
   
   # Or directly
   node src/app.js
   ```

---

## Functional Overview

The AU Sports Inventory system manages the issuing and returning of sports equipment with specialized views for guards, students, and admins.

### 1. Guard Workflow
- **Issue Equipment**: Scan student's Ashoka ID QR to log them in. Select equipment and quantities to issue. The system tracks availability in real-time.
- **Return Equipment**: Scan ID to see outstanding items. Mark items as returned (optionally as damaged).

### 2. Student Portal
- **QR Login**: Students access their personalized issue/return dashboard by scanning a QR code at the mailroom.
- **Sports Teams**: Members of authorized sports teams can access dedicated portals to issue/return team-specific equipment based on approved requests.

### 3. Admin Dashboard
- **Inventory Management**: Real-time dashboard to add new equipment, update stock levels, and monitor damaged items.
- **Statistics & Analytics**: Visual data on equipment usage trends and inventory health.
- **Offence Tracking**: Automated tracking of students with overdue equipment and history of offences.
- **Request Authorization**: Create and manage sports team authorizations for specific time periods.

### 4. Technical Stack
- **Backend**: Node.js, Express.js
- **Database**: MySQL with **Prisma ORM**
- **Frontend**: EJS (Embedded JavaScript Templates), Vanilla CSS
- **Auth**: Google OAuth 2.0 (Admin), QR-based Sessions (Students)

---

## Deployment with PM2
To keep the application running in production:
```bash
pm2 start npm --name "sports-inventory" -- start
```
