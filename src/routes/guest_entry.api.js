import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/business/vacant-rooms
 * Fetch all vacant rooms for a business
 */
router.get('/vacant-rooms', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      return res.status(400).json({ message: 'Missing businessId parameter' });
    }

    const [rows] = await db.pool.execute(
      `SELECT id, room_number, capacity, room_status
       FROM rooms
       WHERE business_id = ? AND room_status = 'vacant'
       ORDER BY room_number`,
      [businessId]
    );

    const data = rows.map(r => ({
      id: r.id,
      roomNumber: r.room_number,
      capacity: r.capacity,
      roomStatus: r.room_status,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/business/guest-entries
 * Submits a new guest entry with lead guest demographics and room assignments
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
      roomIds,
      purposeOfVisit,
      transportationMode,
      leadCountry,
      leadMunicipality,
      leadProvince,
      leadNationality,
      leadPhilippinesRegion,
      leadIsOverseas,
      leadBirthdate,
      leadSex,
    } = req.body;

    if (!businessId || !checkIn || !checkOut || !totalGuests) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const guestRecordId = id || uuidv4();
    const lengthOfStay = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)));

    await connection.beginTransaction();

    // Idempotency check
    if (id) {
      const [existingRows] = await connection.execute(
        `SELECT id, business_id FROM guest_records WHERE id = ? LIMIT 1`,
        [id]
      );

      if (existingRows.length > 0) {
        const existing = existingRows[0];
        await connection.commit();

        if (existing.business_id !== businessId) {
          return res.status(409).json({ message: 'A record with that value already exists.' });
        }

        return res.status(200).json({
          message: 'Guest entry already synced',
          guestRecordId: existing.id,
          alreadyExisted: true,
        });
      }
    }

    // Compute length_of_stay from dates
    await connection.execute(
      `INSERT INTO guest_records (
        id, business_id, check_in, check_out, length_of_stay, total_guests,
        purpose_of_visit, transportation_mode,
        lead_country, lead_city_municipality, lead_province,
        lead_nationality, lead_philippines_region, lead_is_overseas,
        lead_birthdate, lead_sex,
        status, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', FALSE)`,
      [
        guestRecordId,
        businessId,
        checkIn,
        checkOut,
        lengthOfStay,
        totalGuests,
        purposeOfVisit,
        transportationMode,
        leadCountry || null,
        leadMunicipality || null,
        leadProvince || null,
        leadIsOverseas ? null : (leadNationality || 'Foreign'),
        leadPhilippinesRegion || null,
        leadIsOverseas ? 1 : 0,
        leadBirthdate || null,
        leadSex || null,
      ]
    );

    // Insert room associations into junction table
    if (roomIds && roomIds.length > 0) {
      for (const roomId of roomIds) {
        const junctionId = uuidv4();
        await connection.execute(
          `INSERT INTO guest_record_rooms (id, guest_record_id, room_id) VALUES (?, ?, ?)`,
          [junctionId, guestRecordId, roomId]
        );
      }

      // Mark selected rooms as occupied
      const placeholders = roomIds.map(() => '?').join(',');
      await connection.execute(
        `UPDATE rooms SET room_status = 'occupied' WHERE id IN (${placeholders})`,
        roomIds
      );
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
