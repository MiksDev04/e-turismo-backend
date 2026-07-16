import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import upload from '../middleware/upload.js';
import cloudinary from '../config/cloudinary.js';
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

function validateBusinessAccount(body) {
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

router.post('/register/send-confirmation', async (req, res, next) => {
  try {
    const validationError = validateBusinessAccount(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
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
      `DELETE FROM pending_email_confirmations WHERE purpose = 'business_registration' AND email = ?`,
      [email]
    );

    await db.pool.execute(
      `INSERT INTO pending_email_confirmations
         (id, purpose, full_name, username, email, phone, password_hash, confirmation_token, expires_at)
       VALUES (?, 'business_registration', ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
      [id, fullName, username, email, phoneNumber, hashedPassword, token]
    );

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const confirmationUrl = `${backendUrl}/api/auth/register/confirm?token=${token}`;

    await mailer.sendEmailConfirmation(email, confirmationUrl, {
      subject: 'Confirm Your Email – San Pablo City Tourism Office',
      label: 'Registration',
      heading: 'Confirm Your Email Address',
      body: `Thank you for registering with the <strong>San Pablo City Tourism Record Management System</strong>. Click the button below to confirm your email address and complete your registration.`,
      buttonLabel: 'Confirm Email Address',
    });

    res.json({ message: 'Confirmation email sent. Please check your inbox.' });
  } catch (err) {
    next(err);
  }
});

router.get('/register/confirm', async (req, res, next) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(simpleHtmlPage('Invalid Link', 'Missing confirmation token.'));
    }

    const [rows] = await db.pool.execute(
      `SELECT id, email, expires_at, confirmed_at
       FROM pending_email_confirmations
       WHERE purpose = 'business_registration' AND confirmation_token = ?
       LIMIT 1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).send(simpleHtmlPage('Invalid Link', 'This confirmation link is not valid.'));
    }

    const pending = rows[0];

    if (pending.confirmed_at) {
      return res.send(simpleHtmlPage('Already Confirmed', 'Your email has already been confirmed. You can close this tab and continue your registration.'));
    }

    if (new Date(pending.expires_at) < new Date()) {
      await db.pool.execute('DELETE FROM pending_email_confirmations WHERE id = ?', [pending.id]);
      return res.status(400).send(simpleHtmlPage('Link Expired', 'This confirmation link has expired. Please start your registration again.'));
    }

    await db.pool.execute(
      'UPDATE pending_email_confirmations SET confirmed_at = NOW() WHERE id = ?',
      [pending.id]
    );

    res.send(simpleHtmlPage(
      'Email Confirmed',
      'Your email has been confirmed successfully. You can close this tab and continue your registration.'
    ));
  } catch (err) {
    next(err);
  }
});

router.get('/register/confirmation-status', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.query.email);

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const [rows] = await db.pool.execute(
      `SELECT confirmed_at
       FROM pending_email_confirmations
       WHERE purpose = 'business_registration' AND email = ?
       LIMIT 1`,
      [email]
    );

    const confirmed = rows.length > 0 && rows[0].confirmed_at !== null;
    res.json({ confirmed });
  } catch (err) {
    next(err);
  }
});

router.post('/register', upload.fields([
  { name: 'permit_file', maxCount: 1 },
  { name: 'valid_id',    maxCount: 1 }
]), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      fullName,
      username,
      email,
      password,
      phoneNumber,
      businessName,
      tradeName,
      businessType,
      businessLine,
      ownerFirstName,
      ownerMiddleName,
      ownerLastName,
      totalRooms,
      permitNumber,
      registrationNumber,
      street,
      barangay,
      cityMunicipality,
      province,
      region
    } = req.body;

    const accountValidationError = validateBusinessAccount(req.body);
    if (accountValidationError) {
      return res.status(400).json({ message: accountValidationError });
    }

    if (!businessName) {
      return res.status(400).json({ message: 'Business name is required.' });
    }

    const files = req.files;
    if (!files || !files.permit_file || !files.valid_id) {
      return res.status(400).json({ message: 'Missing required files (permit or valid ID)' });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = normalizeEmail(email);

    if (await hasUserConflict({
      username: normalizedUsername,
      email: normalizedEmail,
      connection,
    })) {
      return res.status(409).json({ message: 'Username or email is already taken.' });
    }

    const [pendingRows] = await connection.execute(
      `SELECT id, password_hash
       FROM pending_email_confirmations
       WHERE purpose = 'business_registration'
         AND email = ?
         AND confirmed_at IS NOT NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [normalizedEmail]
    );

    if (pendingRows.length === 0) {
      return res.status(400).json({ message: 'Please confirm your email before submitting.' });
    }

    const pending = pendingRows[0];

    await connection.beginTransaction();

    const userId = uuidv4();

    await connection.execute(
      `INSERT INTO users (id, full_name, phone, email, username, password, role) 
       VALUES (?, ?, ?, ?, ?, ?, 'business')`,
      [
        userId,
        fullName,
        normalizePhone(phoneNumber),
        normalizedEmail,
        normalizedUsername,
        pending.password_hash
      ]
    );

    const businessId = uuidv4();

    const permitFile = files.permit_file[0];
    const validIdFile = files.valid_id[0];

    const permitUpload = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'raw', folder: 'tourism/permits', public_id: businessId, overwrite: true },
        (err, result) => { if (err) reject(err); else resolve(result); }
      );
      stream.end(permitFile.buffer);
    });

    const validIdUpload = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'raw', folder: 'tourism/valid_ids', public_id: businessId, overwrite: true },
        (err, result) => { if (err) reject(err); else resolve(result); }
      );
      stream.end(validIdFile.buffer);
    });

    const permitUrl = permitUpload.secure_url;
    const validIdUrl = validIdUpload.secure_url;

    let parsedBusinessLine = businessLine;
    if (typeof businessLine === 'string') {
      try {
        parsedBusinessLine = JSON.parse(businessLine);
      } catch (e) {
        parsedBusinessLine = businessLine.split(',').map(s => s.trim());
      }
    }

    await connection.execute(
      `INSERT INTO businesses (
        id, user_id, business_name, tradename, business_type, 
        owner_first_name, owner_middle_name, owner_last_name, 
        business_line, total_rooms, permit_number, registration_number, 
        street, barangay, city_municipality, province, region, 
        permit_file_url, valid_id_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        businessId,
        userId,
        businessName,
        tradeName || null,
        businessType || 'sole_proprietorship',
        ownerFirstName,
        ownerMiddleName || null,
        ownerLastName,
        JSON.stringify(parsedBusinessLine || []),
        parseInt(totalRooms) || 0,
        permitNumber,
        registrationNumber,
        street,
        barangay,
        cityMunicipality,
        province,
        region,
        permitUrl,
        validIdUrl
      ]
    );

    // Insert rooms
    let parsedRooms = [];
    if (req.body.rooms) {
      try {
        parsedRooms = typeof req.body.rooms === 'string'
          ? JSON.parse(req.body.rooms)
          : req.body.rooms;
      } catch (e) {
        parsedRooms = [];
      }
    }

    for (const room of parsedRooms) {
      const roomNumber = String(room.name || '').trim();
      const occupancy = parseInt(room.capacity) || 1;
      if (roomNumber) {
        const roomId = uuidv4();
        await connection.execute(
          `INSERT INTO rooms (id, business_id, room_number, occupancy) VALUES (?, ?, ?, ?)`,
          [roomId, businessId, roomNumber, occupancy]
        );
      }
    }

    await connection.execute('DELETE FROM pending_email_confirmations WHERE id = ?', [pending.id]);

    await connection.commit();

    res.status(201).json({
      message: 'Registration successful. Your account is pending approval.',
      userId,
      businessId
    });

  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
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
