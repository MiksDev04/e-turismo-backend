import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { parseOriginGroups } from '../utils/originGroups.js';

const router = express.Router();

/**
 * GET /api/business/vacant-rooms
 * Fetch all available rooms for a business (vacant + reserved)
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
       WHERE business_id = ? AND room_status IN ('vacant', 'reserved')
       ORDER BY room_number`,
      [businessId]
    );

    const data = rows.map(r => ({
      id: r.id,
      roomNumber: r.room_number,
      capacity: r.capacity,
      status: r.room_status,
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
      actualCheckOut,
      totalGuests,
      roomIds,
      purposeOfVisit,
      leadCountry,
      leadMunicipality,
      leadProvince,
      leadNationality,
      leadIsOverseas,
      leadBirthdate,
      leadSex,
      status,
      maleCount,
      femaleCount,
      originGroups,
    } = req.body;

    if (!businessId || !checkIn || !checkOut || !totalGuests || !leadSex) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    if (!['male', 'female'].includes(leadSex?.toLowerCase())) {
      return res.status(400).json({ message: 'leadSex must be "male" or "female"' });
    }

    const hasGroups = Array.isArray(originGroups) && originGroups.length > 0;
    let parsedGroups = [];

    const totalGuestsInt = parseInt(totalGuests, 10) || 1;
    let maleCountInt;
    let femaleCountInt;

    if (hasGroups) {
      // When origin groups exist, the parent counts are DERIVED from the
      // group sums and the client-sent values are overwritten (auto-derive
      // wins — internal consistency, not accuracy).
      const parsed = parseOriginGroups(originGroups);
      if (!parsed.ok) {
        return res.status(400).json({ message: parsed.message });
      }
      parsedGroups = parsed.groups;
      maleCountInt = parsedGroups.reduce((sum, g) => sum + g.maleCount, 0);
      femaleCountInt = parsedGroups.reduce((sum, g) => sum + g.femaleCount, 0);
    } else {
      // Male/female counts: optional. If one is missing it is derived from the
      // other; if both are blank, fall back to the PSA 47.1%/52.9% split.
      maleCountInt = parseInt(maleCount, 10) || 0;
      femaleCountInt = parseInt(femaleCount, 10) || 0;
      if (!maleCountInt && !femaleCountInt) {
        maleCountInt = Math.round(totalGuestsInt * 0.471);
        femaleCountInt = totalGuestsInt - maleCountInt;
      } else if (!maleCountInt) {
        maleCountInt = totalGuestsInt - femaleCountInt;
      } else if (!femaleCountInt) {
        femaleCountInt = totalGuestsInt - maleCountInt;
      }
    }

    const totalGuestsSaved = hasGroups ? maleCountInt + femaleCountInt : totalGuestsInt;

    const guestRecordId = id || uuidv4();

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

    await connection.execute(
      `INSERT INTO guest_records (
        id, business_id, check_in, check_out, actual_check_out, total_guests,
        male_count, female_count, purpose_of_visit,
        lead_country, lead_city_municipality, lead_province,
        lead_nationality, lead_is_overseas,
        lead_birthdate, lead_sex,
        status, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [
        guestRecordId,
        businessId,
        checkIn,
        checkOut,
        actualCheckOut || null,
        totalGuestsSaved,
        maleCountInt,
        femaleCountInt,
        purposeOfVisit,
        leadCountry || null,
        leadMunicipality || null,
        leadProvince || null,
        leadIsOverseas ? null : (leadNationality || 'Foreign'),
        leadIsOverseas ? 1 : 0,
        leadBirthdate || null,
        leadSex || null,
        status || 'active',
      ]
    );

    // Insert room associations into junction table
    if (roomIds && roomIds.length > 0) {
      const junctionStatus = actualCheckOut ? 'completed' : 'active';
      for (const roomId of roomIds) {
        const junctionId = uuidv4();
        await connection.execute(
          `INSERT INTO guest_record_rooms (id, guest_record_id, room_id, status) VALUES (?, ?, ?, ?)`,
          [junctionId, guestRecordId, roomId, junctionStatus]
        );
      }

      // Only mark rooms occupied if the guest is NOT already checked out
      if (!actualCheckOut) {
        const placeholders = roomIds.map(() => '?').join(',');
        await connection.execute(
          `UPDATE rooms SET room_status = 'occupied' WHERE id IN (${placeholders})`,
          roomIds
        );
      }
    }

    // Insert origin group breakdown rows (derived counts live on the parent).
    if (hasGroups) {
      for (const group of parsedGroups) {
        await connection.execute(
          `INSERT INTO guest_origin_breakdowns (
            id, guest_record_id, country, is_overseas,
            province, city_municipality, male_count, female_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            guestRecordId,
            group.country,
            group.isOverseas ? 1 : 0,
            group.province,
            group.cityMunicipality,
            group.maleCount,
            group.femaleCount,
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
