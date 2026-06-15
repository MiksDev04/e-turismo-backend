import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';

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
      'SELECT * FROM users WHERE username = ? AND deleted_at IS NULL',
      [username.trim().toLowerCase()]
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
        total_rooms: business.total_rooms,
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

export default router;
