import mysql from "mysql2/promise";

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

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