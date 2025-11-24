import mysql from "mysql2/promise";

// Default to local MySQL for the Sports-Inventory app. Environment variables override these.
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sportsinventory',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONN_LIMIT || '10'),
  queueLimit: 0,
  // Short, reasonable timeout for local development
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000'),
  // Keep-alive improves stability for long-running dev servers
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

const pool = mysql.createPool(dbConfig);

// Lightweight wrapper exposing both callback and promise styles (keeps existing API)
const db = {
  // Supports both callback and promise styles.
  // Usage (callback): db.query(sql, params, (err, rows) => {})
  // Usage (promise): const rows = await db.query(sql, params)
  query(sql, params, cb) {
    // normalize args: params optional
    if (typeof params === 'function') {
      cb = params;
      params = [];
    }

    if (typeof cb === 'function') {
      // callback style
      return pool.query(sql, params, (err, results, fields) => cb(err, results, fields));
    }

    // promise style - resolve to rows only for compatibility
    return pool.query(sql, params).then(([rows, fields]) => rows);
  },

  getConnection() {
    return pool.getConnection();
  }
};

export default db;
export { db };
export { pool };

// Test pool connection on startup (non-blocking). Helpful in development.
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅ MySQL pool connected (${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    conn.release();
  } catch (err) {
    console.warn(`⚠️ Could not verify MySQL pool connection: ${err.message}`);
  }
})();