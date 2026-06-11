import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '1234',
  database:           process.env.DB_NAME     || 'tourism_db',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  // Return proper JS Date objects and BigInt as strings
  dateStrings:        false,
  supportBigNumbers:  true,
  bigNumberStrings:   false,
});


async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
}

export default { pool, testConnection };