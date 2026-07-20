import mysql from 'mysql2/promise';

const isVercel = !!process.env.VERCEL;

export const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '1234',
  database:           process.env.DB_NAME     || 'tourism_db',
  waitForConnections: true,
  // Serverless: keep pool small — each invocation creates its own pool
  connectionLimit:    isVercel ? 2 : 10,
  queueLimit:         isVercel ? 5 : 0,
  // Abort connection attempt after 10 s (Aiven MySQL may be slower from Vercel edge)
  connectTimeout:     10000,
  // Return dates as strings to avoid timezone shifting
  dateStrings:        true,
  supportBigNumbers:  true,
  bigNumberStrings:   false,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
});


export async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
}

export async function queryWithRetry(fn, retries = 1) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0 && err.code === 'ETIMEDOUT') {
      await new Promise(r => setTimeout(r, 500));
      return queryWithRetry(fn, retries - 1);
    }
    throw err;
  }
}

export default { pool, testConnection, queryWithRetry };