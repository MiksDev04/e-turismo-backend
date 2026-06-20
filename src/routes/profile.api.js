import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import mailer from '../utils/mailer.js';

const router = express.Router();

/**
 * GET /api/profile
 * Returns profile + business data for current user
 */
router.get('/profile', auth.authenticate, async (req, res, next) => {
  try {
    const [users] = await db.pool.execute(
      'SELECT id, full_name, username, email, phone, role, created_at, updated_at FROM users WHERE id = ? AND deleted_at IS NULL',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    const user = users[0];
    let responseData = { user };

    if (user.role === 'business') {
      const [businesses] = await db.pool.execute(
        'SELECT * FROM businesses WHERE user_id = ? AND deleted_at IS NULL',
        [user.id]
      );
      responseData.business = businesses[0] || null;
    }

    res.json(responseData);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/profile
 * Updates basic account info (name, phone, username)
 */
router.put('/profile', auth.authenticate, async (req, res, next) => {
  try {
    const { full_name, phone, username } = req.body;

    if (!full_name || !phone || !username) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Check username availability if changed
    const [existing] = await db.pool.execute(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username.trim().toLowerCase(), req.user.id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    await db.pool.execute(
      'UPDATE users SET full_name = ?, phone = ?, username = ? WHERE id = ?',
      [full_name.trim(), phone.trim(), username.trim().toLowerCase(), req.user.id]
    );

    res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/business
 * Updates business details (for business users)
 */
router.put('/business', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  try {
    const {
      business_name, tradename, owner_first_name, owner_middle_name, owner_last_name,
      business_type, business_line, total_rooms, street, barangay,
      city_municipality, province, region, permit_number, registration_number
    } = req.body;

    if (!business_name || !business_type || !business_line) {
      return res.status(400).json({ message: 'Required fields missing.' });
    }

    await db.pool.execute(
      `UPDATE businesses SET 
        business_name = ?, tradename = ?, owner_first_name = ?, owner_middle_name = ?, owner_last_name = ?,
        business_type = ?, business_line = ?, total_rooms = ?, street = ?, barangay = ?,
        city_municipality = ?, province = ?, region = ?, permit_number = ?, registration_number = ?
      WHERE user_id = ?`,
      [
        business_name.trim(), tradename?.trim(), owner_first_name?.trim(), owner_middle_name?.trim(), owner_last_name?.trim(),
        business_type, JSON.stringify(business_line), total_rooms || 0, street?.trim(), barangay?.trim(),
        city_municipality?.trim(), province?.trim(), region?.trim(), permit_number?.trim(), registration_number?.trim(),
        req.user.id
      ]
    );

    res.json({ message: 'Business information updated.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/profile/change-password
 * Updates password for logged-in user
 */
router.post('/change-password', auth.authenticate, async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({ message: 'Current and new passwords are required.' });
    }

    // 1. Fetch user's current password hash
    const [users] = await db.pool.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found.' });

    // 2. Verify old password
    const isMatch = await bcrypt.compare(old_password, users[0].password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect current password.' });
    }

    // 3. Hash and save new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    await db.pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/send-email-otp
 * Sends OTP to CURRENT email to verify identity for email/password change
 */
router.post('/send-email-otp', auth.authenticate, async (req, res, next) => {
  try {
    const [users] = await db.pool.execute('SELECT email, full_name FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found.' });
    
    const user = users[0];
    if (!user.email) return res.status(400).json({ message: 'No email associated with this account.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await db.pool.execute('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, expiry, req.user.id]);

    try {
      await mailer.sendOtp(user.email, otp);
      console.log(`[MAIL] Identity verification code sent to ${user.email}`);
    } catch (mailErr) {
      console.error('[MAIL ERROR]', mailErr);
    }

    res.json({ message: 'Verification code sent to your email.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/update-email
 * Sends a confirmation link to the new email instead of directly updating it
 */
router.put('/update-email', auth.authenticate, async (req, res, next) => {
  try {
    const { new_email, otp } = req.body;
    if (!new_email || !otp) return res.status(400).json({ message: 'New email and code are required.' });

    // Verify OTP first
    const [users] = await db.pool.execute(
      'SELECT id, email, full_name FROM users WHERE id = ? AND reset_otp = ? AND reset_otp_expiry > NOW()',
      [req.user.id, otp.trim()]
    );

    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const normalisedEmail = new_email.trim().toLowerCase();

    // Check if new email is already in use
    const [existing] = await db.pool.execute(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [normalisedEmail, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email address is already in use.' });
    }

    // Generate confirmation token
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Clear the OTP and store pending email + token
    await db.pool.execute(
      `UPDATE users SET
        reset_otp = NULL, reset_otp_expiry = NULL,
        new_email = ?, email_confirm_token = ?, email_confirm_expiry = ?
      WHERE id = ?`,
      [normalisedEmail, token, expiry, req.user.id]
    );

    // Build confirmation URL from BACKEND_URL env or fall back to request host
    const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const confirmationUrl = `${baseUrl}/api/confirm-email?token=${token}`;

    // Send confirmation email to the NEW email
    try {
      await mailer.sendEmailConfirmation(normalisedEmail, confirmationUrl);
      console.log(`[MAIL] Email confirmation sent to ${normalisedEmail}`);
    } catch (mailErr) {
      console.error('[MAIL ERROR]', mailErr);
    }

    res.json({
      message: `A confirmation link has been sent to ${normalisedEmail}. Please check your inbox and click the link to complete the change.`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/confirm-email
 * Handles the email confirmation link click
 */
router.get('/confirm-email', async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(simpleHtmlPage(
        'Invalid Link',
        'This confirmation link is invalid. Please request a new email change.'
      ));
    }

    const [users] = await db.pool.execute(
      'SELECT id, new_email FROM users WHERE email_confirm_token = ? AND email_confirm_expiry > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).send(simpleHtmlPage(
        'Link Expired or Invalid',
        'This confirmation link has expired or is invalid. Please request a new email change from your profile settings.'
      ));
    }

    const user = users[0];

    // Update email and clear confirmation fields
    await db.pool.execute(
      `UPDATE users SET
        email = new_email,
        new_email = NULL,
        email_confirm_token = NULL,
        email_confirm_expiry = NULL
      WHERE id = ?`,
      [user.id]
    );

    res.send(simpleHtmlPage(
      'Email Confirmed Successfully',
      'Your email address has been updated successfully. You can now use your new email to log in.'
    ));
  } catch (err) {
    next(err);
  }
});

function simpleHtmlPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} – San Pablo City Tourism Office</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      background-color: #f4f6f9;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      padding: 48px 40px;
      max-width: 480px;
      text-align: center;
    }
    .badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 64px; height: 64px;
      background-color: #e6f7ff;
      border-radius: 50%;
      margin-bottom: 20px;
    }
    .badge svg { width: 32px; height: 32px; fill: #0077b6; }
    h1 { color: #1a1a2e; font-size: 22px; margin-bottom: 12px; }
    p { color: #555; font-size: 15px; line-height: 1.6; }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 12px; color: #aaa;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">
      San Pablo City Tourism Office &bull; Tourism Record Management System
    </div>
  </div>
</body>
</html>`;
}

export default router;