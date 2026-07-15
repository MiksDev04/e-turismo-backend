import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import mailer from './mailer.js';

export const EMAIL_OTP_PURPOSES = Object.freeze({
  ADMIN_SETUP: 'admin_setup',
  BUSINESS_REGISTRATION: 'business_registration',
});

const OTP_EXPIRY_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendEmailVerificationOtp({ purpose, email }) {
  const normalizedEmail = normalizeEmail(email);

  const [recentRows] = await db.pool.execute(
    `SELECT last_sent_at
     FROM email_verification_otps
     WHERE purpose = ?
       AND email = ?
       AND last_sent_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
     LIMIT 1`,
    [purpose, normalizedEmail, RESEND_COOLDOWN_SECONDS]
  );

  if (recentRows.length > 0) {
    const error = new Error(
      'Please wait before requesting another verification code.'
    );
    error.status = 429;
    throw error;
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const id = uuidv4();

  await db.pool.execute(
    'DELETE FROM email_verification_otps WHERE purpose = ? AND email = ?',
    [purpose, normalizedEmail]
  );

  await db.pool.execute(
    `INSERT INTO email_verification_otps
       (id, purpose, email, otp_hash, expires_at, attempt_count, last_sent_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, NOW())`,
    [id, purpose, normalizedEmail, otpHash, OTP_EXPIRY_MINUTES]
  );

  try {
    await mailer.sendOtp(normalizedEmail, otp);
  } catch (err) {
    await db.pool.execute(
      'DELETE FROM email_verification_otps WHERE id = ?',
      [id]
    );
    const error = new Error(
      'Failed to send verification code. Please try again later.'
    );
    error.status = 500;
    throw error;
  }
}

export async function verifyEmailOtp({ purpose, email, otp, connection = db.pool }) {
  const normalizedEmail = normalizeEmail(email);
  const code = String(otp || '').trim();

  if (!/^\d{6}$/.test(code)) {
    const error = new Error('Enter the 6-digit verification code.');
    error.status = 400;
    throw error;
  }

  const [rows] = await connection.execute(
    `SELECT id, otp_hash, attempt_count, expires_at
     FROM email_verification_otps
     WHERE purpose = ?
       AND email = ?
     LIMIT 1`,
    [purpose, normalizedEmail]
  );

  if (rows.length === 0) {
    const error = new Error('Verification code not found. Please request a new code.');
    error.status = 400;
    throw error;
  }

  const row = rows[0];

  if (Number(row.attempt_count) >= MAX_ATTEMPTS) {
    const error = new Error('Too many incorrect attempts. Please request a new code.');
    error.status = 429;
    throw error;
  }

  const [expiryRows] = await connection.execute(
    `SELECT CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END AS valid
     FROM email_verification_otps
     WHERE id = ?`,
    [row.id]
  );

  if (Number(expiryRows[0].valid) !== 1) {
    await connection.execute('DELETE FROM email_verification_otps WHERE id = ?', [row.id]);
    const error = new Error('Verification code has expired. Please request a new code.');
    error.status = 400;
    throw error;
  }

  const isMatch = await bcrypt.compare(code, row.otp_hash);
  if (!isMatch) {
    await connection.execute(
      'UPDATE email_verification_otps SET attempt_count = attempt_count + 1 WHERE id = ?',
      [row.id]
    );
    const error = new Error('Incorrect verification code.');
    error.status = 400;
    throw error;
  }
}

export async function clearEmailOtp({ purpose, email, connection = db.pool }) {
  await connection.execute(
    'DELETE FROM email_verification_otps WHERE purpose = ? AND email = ?',
    [purpose, normalizeEmail(email)]
  );
}
