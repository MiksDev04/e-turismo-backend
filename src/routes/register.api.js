import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import upload from '../middleware/upload.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Handles business user registration with file uploads.
 */
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
      businessLine, // Expecting JSON string if from multipart, or array if already parsed
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

    // 1. Basic Validation
    if (!username || !password || !email || !businessName) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const files = req.files;
    if (!files || !files.permit_file || !files.valid_id) {
      return res.status(400).json({ message: 'Missing required files (permit or valid ID)' });
    }

    // 2. Check if username exists
    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE username = ?',
      [username.trim().toLowerCase()]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    // 3. Start Transaction
    await connection.beginTransaction();

    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Insert into users table
    await connection.execute(
      `INSERT INTO users (id, full_name, phone, email, username, password, role) 
       VALUES (?, ?, ?, ?, ?, ?, 'business')`,
      [
        userId,
        fullName,
        phoneNumber,
        email,
        username.trim().toLowerCase(),
        hashedPassword
      ]
    );

    // 5. Insert into businesses table
    const businessId = uuidv4();
    const permitUrl = `/uploads/permits/${files.permit_file[0].filename}`;
    const validIdUrl = `/uploads/valid_ids/${files.valid_id[0].filename}`;

    // businessLine might be a string from multipart/form-data
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

    // 6. Commit Transaction
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

export default router;