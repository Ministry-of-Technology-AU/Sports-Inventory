import mysql from "mysql2/promise";

// Database configuration for local MySQL (SportsInventory)
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'SportsInventory',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Wrapper to support both callback and promise styles
const db = {
  // Supports both callback and promise styles.
  // Usage (callback): db.query(sql, params, (err, rows) => {})
  // Usage (promise): const rows = await db.query(sql, params)
  query(sql, params, cb) {
    // Normalize args: params optional
    if (typeof params === 'function') {
      cb = params;
      params = [];
    }

    if (typeof cb === 'function') {
      // Callback style - convert promise to callback
      pool.query(sql, params)
        .then(([rows, fields]) => cb(null, rows, fields))
        .catch(err => cb(err, null, null));
      return;
    }

    // Promise style - resolve to rows only for compatibility
    return pool.query(sql, params).then(([rows, fields]) => rows);
  },

  getConnection() {
    return pool.getConnection();
  }
};

export default db;
export { db, pool };

// Test pool connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅ MySQL pool connected (${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    conn.release();
  } catch (err) {
    console.warn(`⚠️ Could not verify MySQL pool connection: ${err.message}`);
    console.warn(`   Make sure MySQL is running and database '${dbConfig.database}' exists`);
  }
})();
