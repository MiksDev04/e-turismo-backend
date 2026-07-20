import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';
import mailer from '../utils/mailer.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Authenticates user and returns profile + business data + JWT
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    // 1. Fetch user by username
    const [users] = await db.pool.execute(
      'SELECT * FROM users WHERE (username = ? OR email = ?) AND deleted_at IS NULL',
      [username.trim().toLowerCase(), username.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Incorrect username or password.' });
    }

    const user = users[0];

    // 2. Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect username or password.' });
    }

    // 3. Prepare response data
    let responseData = {
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      business: null
    };

    // 4. If business role, fetch business details
    if (user.role === 'business') {
      const [businesses] = await db.pool.execute(
        'SELECT * FROM businesses WHERE user_id = ? AND deleted_at IS NULL',
        [user.id]
      );

      if (businesses.length === 0) {
        return res.status(404).json({ message: 'Business profile not found. Please contact support.' });
      }

      const business = businesses[0];

      const [roomCountRows] = await db.pool.execute(
        'SELECT COUNT(*) AS count FROM rooms WHERE business_id = ?',
        [business.id]
      );
      const totalRooms = roomCountRows[0]?.count || 0;

      // Check status
      if (business.status === 'pending') {
        return res.status(403).json({ message: 'Your account is still pending approval.' });
      }
      if (business.status === 'suspended') {
        return res.status(403).json({ message: 'Your account is suspended because of violations.' });
      }
      if (business.status === 'rejected') {
        return res.status(403).json({ message: 'Your account application was not approved.' });
      }

      responseData.business = {
        id: business.id,
        business_name: business.business_name,
        permit_number: business.permit_number,
        registration_number: business.registration_number,
        street: business.street,
        total_rooms: totalRooms,
        permit_file_url: business.permit_file_url,
        valid_id_url: business.valid_id_url,
        status: business.status,
        remarks: business.remarks,
        region: business.region,
        city_municipality: business.city_municipality,
        province: business.province,
        barangay: business.barangay,
        tradename: business.tradename,
        business_line: business.business_line,
        owner_first_name: business.owner_first_name,
        owner_last_name: business.owner_last_name,
        owner_middle_name: business.owner_middle_name,
        business_type: business.business_type
      };
    }

    // 5. Generate JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      ...responseData
    });

  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/forgot-password
 * Sends a 6-digit OTP to the user's email
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    // 1. Find user by email
    const [users] = await db.pool.execute(
      'SELECT id, email FROM users WHERE email = ? AND deleted_at IS NULL',
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      // For security, don't reveal if email exists, but the frontend expects an error if it doesn't 
      // based on the catch block in LoginApi.dart. However, many systems prefer a generic message.
      // Given the requirement "make sure the otp works", I'll provide clear feedback.
      return res.status(404).json({ message: 'No account found with that email address.' });
    }

    const user = users[0];

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // 3. Save OTP and expiry to database
    await db.pool.execute(
      'UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?',
      [otp, expiry, user.id]
    );

    // 4. Send email
    try {
      await mailer.sendOtp(user.email, otp);
      res.json({ message: 'Reset code sent to your email.' });
    } catch (mailErr) {
      console.error('❌ Mail Error:', mailErr);
      res.status(500).json({ message: 'Failed to send reset code. Please try again later.' });
    }

  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/verify-otp
 * Verifies if the provided OTP is correct and not expired
 */
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and reset code are required.' });
    }

    const [users] = await db.pool.execute(
      'SELECT id, reset_otp, reset_otp_expiry FROM users WHERE email = ? AND deleted_at IS NULL',
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = users[0];

    if (!user.reset_otp || user.reset_otp !== otp) {
      return res.status(400).json({ message: 'Incorrect reset code.' });
    }

    if (new Date() > new Date(user.reset_otp_expiry)) {
      return res.status(400).json({ message: 'Reset code has expired.' });
    }

    res.json({ message: 'OTP verified successfully.' });

  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset-password
 * Resets the password if the OTP is valid
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, otp, new_password } = req.body;

    if (!email || !otp || !new_password) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // 1. Verify OTP again for security
    const [users] = await db.pool.execute(
      'SELECT id, reset_otp, reset_otp_expiry FROM users WHERE email = ? AND deleted_at IS NULL',
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = users[0];

    if (!user.reset_otp || user.reset_otp !== otp) {
      return res.status(400).json({ message: 'Invalid or expired reset session.' });
    }

    if (new Date() > new Date(user.reset_otp_expiry)) {
      return res.status(400).json({ message: 'Reset session has expired.' });
    }

    // 2. Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // 3. Update password and clear OTP
    await db.pool.execute(
      'UPDATE users SET password = ?, reset_otp = NULL, reset_otp_expiry = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password reset successful. You can now sign in with your new password.' });

  } catch (err) {
    next(err);
  }
});

export default router;
