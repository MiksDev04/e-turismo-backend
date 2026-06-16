import express from 'express';
import bcrypt from 'bcryptjs';
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
 * Updates email after verification
 */
router.put('/update-email', auth.authenticate, async (req, res, next) => {
  try {
    const { new_email, otp } = req.body;
    if (!new_email || !otp) return res.status(400).json({ message: 'New email and code are required.' });

    // Verify OTP first
    const [users] = await db.pool.execute(
      'SELECT id FROM users WHERE id = ? AND reset_otp = ? AND reset_otp_expiry > NOW()',
      [req.user.id, otp.trim()]
    );

    if (users.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    // Check if new email is taken
    const [existing] = await db.pool.execute('SELECT id FROM users WHERE email = ? AND id != ?', [new_email.trim().toLowerCase(), req.user.id]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Email address is already in use.' });
    }

    await db.pool.execute(
      'UPDATE users SET email = ?, reset_otp = NULL, reset_otp_expiry = NULL WHERE id = ?',
      [new_email.trim().toLowerCase(), req.user.id]
    );

    res.json({ message: 'Email updated successfully.' });
  } catch (err) {
    next(err);
  }
});

export default router;