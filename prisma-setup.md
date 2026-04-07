# Prisma First-Time Setup

This guide is for setting up the database for the first time on a fresh local environment.

## 1. Prerequisites

- Node.js v22.15.0 or newer installed
- MySQL running locally
- Database created: `SportsInventory`

If `npm install` prints an `EBADENGINE` warning, your local Node version is too old for this project. Upgrade to Node 22.15.0+ before continuing.

## 2. Configure environment variables

Create or update `.env` in the project root:

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=password
DB_NAME=SportsInventory
DB_PORT=3306
DATABASE_URL="mysql://root@127.0.0.1:3306/SportsInventory"
```

If your MySQL user/password is different, update `DB_USER`, `DB_PASSWORD`, and `DATABASE_URL` accordingly.

## 3. Install dependencies

```bash
npm install
```

## 4. Make sure shell DATABASE_URL does not override project .env

In the same terminal where you run Prisma commands:

```bash
unset DATABASE_URL
```

Check value (should be empty):

```bash
echo "$DATABASE_URL"
```

## 5. Sync schema to database

Run from project root:

```bash
npx prisma db push
npx prisma generate
```

## 6. Verify schema is applied

Open Prisma Studio:

```bash
npx prisma studio
```

Or verify directly in MySQL:

```sql
SHOW COLUMNS FROM Logs LIKE 'cycleID';
```

Expected result: `cycleID` exists as `varchar(50)` and allows `NULL`.

## 7. Start application

```bash
node src/app.js
```

## Notes for existing databases

If you are not on a fresh database and Prisma reports drift, do not run reset commands on production data.

For existing local databases with drift, apply only the required column manually:

```sql
ALTER TABLE Logs ADD COLUMN cycleID VARCHAR(50) NULL;
```

Then run:

```bash
npx prisma generate
```
