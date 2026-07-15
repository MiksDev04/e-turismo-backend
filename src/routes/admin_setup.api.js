import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';

const router = express.Router();

const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;
const emailRe = /^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$/;
const phoneRe = /^(09|\+639)\d{9}$/;
const specialCharacterRe = /[!@#$%^&*()\-_=+\[\]{};:',.<>?\/\\|`~@]/;

function normalizePhone(phoneNumber) {
  return String(phoneNumber || '').replace(/[-\s]/g, '');
}

function validateAdminSetup(body) {
  const fullName = String(body.fullName || '').trim();
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const phoneNumber = normalizePhone(body.phoneNumber);
  const password = String(body.password || '');

  if (!fullName) return 'Full name is required.';
  if (!usernameRe.test(username)) {
    return 'Username must be 3-20 characters using letters, numbers, or underscores.';
  }
  if (!emailRe.test(email)) return 'Enter a valid email address.';
  if (!phoneRe.test(phoneNumber)) return 'Invalid phone number format.';
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  if (!specialCharacterRe.test(password)) {
    return 'Password must contain at least one special character.';
  }

  return null;
}

async function hasAdmin(connection = db.pool) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL"
  );
  return Number(rows[0].count) > 0;
}

router.get('/admin-setup/status', async (req, res, next) => {
  try {
    const adminExists = await hasAdmin();
    res.json({
      setupAvailable: !adminExists,
      adminExists,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin-setup/register', async (req, res, next) => {
  const connection = await db.pool.getConnection();
  let lockAcquired = false;

  try {
    const validationError = validateAdminSetup(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK('tourism_first_admin_setup', 10) AS lockAcquired"
    );
    lockAcquired = Number(lockRows[0].lockAcquired) === 1;

    if (!lockAcquired) {
      return res.status(423).json({
        message: 'Admin setup is currently in progress. Please try again.',
      });
    }

    await connection.beginTransaction();

    if (await hasAdmin(connection)) {
      await connection.rollback();
      return res.status(403).json({
        message: 'Admin setup is no longer available.',
      });
    }

    const fullName = req.body.fullName.trim();
    const username = req.body.username.trim().toLowerCase();
    const email = req.body.email.trim().toLowerCase();
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const password = String(req.body.password);

    const [existingUsers] = await connection.execute(
      `SELECT id FROM users
       WHERE deleted_at IS NULL
         AND (username = ? OR LOWER(email) = ?)
       LIMIT 1`,
      [username, email]
    );

    if (existingUsers.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        message: 'Username or email is already taken.',
      });
    }

    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await connection.execute(
      `INSERT INTO users (id, full_name, phone, email, username, password, role)
       VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
      [userId, fullName, phoneNumber, email, username, hashedPassword]
    );

    await connection.commit();

    res.status(201).json({
      message: 'Admin account created successfully. You can now sign in.',
      userId,
    });
  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) {}
    next(err);
  } finally {
    if (lockAcquired) {
      try {
        await connection.execute("SELECT RELEASE_LOCK('tourism_first_admin_setup')");
      } catch (_) {}
    }
    connection.release();
  }
});

export default router;
