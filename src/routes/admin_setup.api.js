import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import mailer from '../utils/mailer.js';

const router = express.Router();

const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;
const emailRe = /^[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}$/;
const phoneRe = /^(09|\+639)\d{9}$/;
const specialCharacterRe = /[!@#$%^&*()\-_=+\[\]{};:',.<>?\/\\|`~@]/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(phoneNumber) {
  return String(phoneNumber || '').replace(/[-\s]/g, '');
}

function validateAdminSetup(body) {
  const fullName = String(body.fullName || '').trim();
  const username = String(body.username || '').trim().toLowerCase();
  const email = normalizeEmail(body.email);
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

async function hasUserConflict({ username, email, connection = db.pool }) {
  const [existingUsers] = await connection.execute(
    `SELECT id FROM users
     WHERE deleted_at IS NULL
       AND (username = ? OR LOWER(email) = ?)
     LIMIT 1`,
    [username.trim().toLowerCase(), normalizeEmail(email)]
  );
  return existingUsers.length > 0;
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

router.post('/admin-setup/request', async (req, res, next) => {
  try {
    const validationError = validateAdminSetup(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    if (await hasAdmin()) {
      return res.status(403).json({
        message: 'Admin setup is no longer available.',
      });
    }

    const fullName = req.body.fullName.trim();
    const username = req.body.username.trim().toLowerCase();
    const email = normalizeEmail(req.body.email);
    const phoneNumber = normalizePhone(req.body.phoneNumber);
    const password = String(req.body.password);

    if (await hasUserConflict({ username, email })) {
      return res.status(409).json({
        message: 'Username or email is already taken.',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const id = uuidv4();

    await db.pool.execute(
      `DELETE FROM pending_email_confirmations WHERE purpose = 'admin_setup' AND email = ?`,
      [email]
    );

    await db.pool.execute(
      `INSERT INTO pending_email_confirmations
         (id, purpose, full_name, username, email, phone, password_hash, confirmation_token, expires_at)
       VALUES (?, 'admin_setup', ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [id, fullName, username, email, phoneNumber, hashedPassword, token]
    );

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const confirmationUrl = `${backendUrl}/api/auth/admin-setup/confirm?token=${token}`;

    await mailer.sendEmailConfirmation(email, confirmationUrl, {
      subject: 'Confirm Your Admin Account – San Pablo City Tourism Office',
      label: 'Admin Account Setup',
      heading: 'Confirm Your Admin Account',
      body: `You are setting up the first admin account for the <strong>San Pablo City Tourism Record Management System</strong>. Click the button below to confirm your email and create your account.`,
      buttonLabel: 'Confirm & Create Admin Account',
    });

    res.json({
      message: 'Confirmation email sent. Please check your inbox.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/admin-setup/confirm', async (req, res, next) => {
  const connection = await db.pool.getConnection();
  let lockAcquired = false;

  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(simpleHtmlPage('Invalid Link', 'Missing confirmation token.'));
    }

    const [rows] = await connection.execute(
      `SELECT id, full_name, username, email, phone, password_hash, expires_at
       FROM pending_email_confirmations
       WHERE purpose = 'admin_setup' AND confirmation_token = ?
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).send(simpleHtmlPage('Invalid Link', 'This confirmation link is not valid.'));
    }

    const pending = rows[0];

    if (new Date(pending.expires_at) < new Date()) {
      await connection.execute('DELETE FROM pending_email_confirmations WHERE id = ?', [pending.id]);
      return res.status(400).send(simpleHtmlPage('Link Expired', 'This confirmation link has expired. Please start the admin setup again.'));
    }

    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK('tourism_first_admin_setup', 10) AS lockAcquired"
    );
    lockAcquired = Number(lockRows[0].lockAcquired) === 1;

    if (!lockAcquired) {
      return res.status(423).send(simpleHtmlPage('Setup In Progress', 'Admin setup is currently in progress. Please try again.'));
    }

    await connection.beginTransaction();

    if (await hasAdmin(connection)) {
      await connection.rollback();
      await connection.execute('DELETE FROM pending_email_confirmations WHERE id = ?', [pending.id]);
      return res.status(403).send(simpleHtmlPage('Setup Unavailable', 'An admin account already exists.'));
    }

    if (await hasUserConflict({ username: pending.username, email: pending.email, connection })) {
      await connection.rollback();
      await connection.execute('DELETE FROM pending_email_confirmations WHERE id = ?', [pending.id]);
      return res.status(409).send(simpleHtmlPage('Conflict', 'Username or email is already taken.'));
    }

    const userId = uuidv4();

    await connection.execute(
      `INSERT INTO users (id, full_name, phone, email, username, password, role)
       VALUES (?, ?, ?, ?, ?, ?, 'admin')`,
      [userId, pending.full_name, pending.phone, pending.email, pending.username, pending.password_hash]
    );

    await connection.execute('DELETE FROM pending_email_confirmations WHERE id = ?', [pending.id]);

    await connection.commit();

    res.send(simpleHtmlPage(
      'Admin Account Created',
      'Your admin account has been created successfully. You can now sign in to the Tourism Record Management System.'
    ));
  } catch (err) {
    try { await connection.rollback(); } catch (_) {}
    next(err);
  } finally {
    if (lockAcquired) {
      try { await connection.execute("SELECT RELEASE_LOCK('tourism_first_admin_setup')"); } catch (_) {}
    }
    connection.release();
  }
});

function simpleHtmlPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} – San Pablo City Tourism Office</title>
  <style>
    body{margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;}
    .card{background:#fff;border-radius:12px;padding:48px 40px;max-width:480px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.1);text-align:center;}
    .icon{width:64px;height:64px;border-radius:50%;background:#e8f5e9;display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px;}
    .icon svg{width:32px;height:32px;fill:#2e7d32;}
    h1{font-size:22px;color:#1a1a2e;margin:0 0 12px;}
    p{font-size:15px;color:#555;line-height:1.6;margin:0 0 24px;}
    .footer{font-size:12px;color:#aaa;line-height:1.8;margin-top:20px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">
      <strong>San Pablo City Tourism Office</strong><br/>
      San Pablo City, Laguna, Philippines
    </div>
  </div>
</body>
</html>`;
}

export default router;
