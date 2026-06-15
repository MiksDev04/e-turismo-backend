import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/business/guest-entries
 * Submits a new guest entry with demographics
 */
router.post('/guest-entries', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      id,
      businessId,
      checkIn,
      checkOut,
      totalGuests,
      roomsOccupied,
      purposeOfVisit,
      transportationMode,
      breakdowns
    } = req.body;

    if (!businessId || !checkIn || !checkOut || !totalGuests || roomsOccupied === undefined) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const guestRecordId = id || uuidv4();

    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO guest_records (
        id, business_id, check_in, check_out, total_guests, 
        rooms_occupied, purpose_of_visit, transportation_mode, status, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', FALSE)`,
      [
        guestRecordId,
        businessId,
        checkIn,
        checkOut,
        totalGuests,
        roomsOccupied,
        purposeOfVisit,
        transportationMode
      ]
    );

    if (breakdowns && breakdowns.length > 0) {
      for (const b of breakdowns) {
        const breakdownId = uuidv4();
        await connection.execute(
          `INSERT INTO guest_breakdowns (
            id, guest_record_id, is_overseas, country, nationality, 
            philippines_region, sex, age_group, count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            breakdownId,
            guestRecordId,
            b.isOverseas ? 1 : 0,
            b.country || null,
            b.nationality || null,
            b.philippinesRegion || null,
            b.sex,
            b.ageGroup,
            b.count
          ]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ message: 'Guest entry saved successfully', guestRecordId });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
