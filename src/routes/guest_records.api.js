import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/business/guest-records
 * Fetch all guest records for a business
 */
router.get('/guest-records', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { businessId } = req.query;

    if (!businessId) {
      return res.status(400).json({ message: 'Missing businessId parameter' });
    }

    // Fetch guest records
    const [records] = await connection.execute(
      `SELECT id, business_id, check_in, check_out, total_guests, rooms_occupied, 
              purpose_of_visit, transportation_mode, status, created_at
       FROM guest_records 
       WHERE business_id = ? AND is_deleted = FALSE 
       ORDER BY check_in DESC`,
      [businessId]
    );

    if (records.length === 0) {
      return res.json([]);
    }

    // Fetch breakdowns for all these records
    const recordIds = records.map(r => r.id);
    const placeholders = recordIds.map(() => '?').join(',');
    const [breakdowns] = await connection.execute(
      `SELECT id, guest_record_id, is_overseas, country, nationality, 
              philippines_region, sex, age_group, count
       FROM guest_breakdowns
       WHERE guest_record_id IN (${placeholders})`,
      recordIds
    );

    // Group breakdowns by guest_record_id
    const breakdownsByRecord = {};
    for (const b of breakdowns) {
      if (!breakdownsByRecord[b.guest_record_id]) {
        breakdownsByRecord[b.guest_record_id] = [];
      }
      breakdownsByRecord[b.guest_record_id].push({
        id: b.id,
        guest_record_id: b.guest_record_id,
        is_overseas: b.is_overseas === 1,
        country: b.country,
        nationality: b.nationality,
        philippines_region: b.philippines_region,
        sex: b.sex,
        age_group: b.age_group,
        count: b.count
      });
    }

    // Attach breakdowns to records
    const result = records.map(r => ({
      ...r,
      guest_breakdowns: breakdownsByRecord[r.id] || []
    }));

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/business/guest-records/:id
 * Updates a guest record and its breakdowns
 */
router.put('/guest-records/:id', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const recordId = req.params.id;
    const {
      checkIn,
      checkOut,
      totalGuests,
      roomsOccupied,
      purposeOfVisit,
      transportationMode,
      breakdowns,
      status, // Optional, could be used for archiving
      businessId, // required for sync creates
    } = req.body;

    await connection.beginTransaction();

    // Check if record exists
    const [existing] = await connection.execute(
      `SELECT id FROM guest_records WHERE id = ?`,
      [recordId]
    );

    const now = new Date();

    if (existing.length === 0) {
      // Create new (Upsert logic for syncPendingCreates)
      if (!businessId) {
        throw new Error('businessId is required to create a new record');
      }
      await connection.execute(
        `INSERT INTO guest_records (
          id, business_id, check_in, check_out, total_guests, 
          rooms_occupied, purpose_of_visit, transportation_mode, status, is_deleted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
        [
          recordId,
          businessId,
          checkIn,
          checkOut,
          totalGuests,
          roomsOccupied,
          purposeOfVisit,
          transportationMode,
          status || 'active',
          now
        ]
      );
    } else {
      // Update existing
      await connection.execute(
        `UPDATE guest_records SET 
          check_in = ?, check_out = ?, total_guests = ?, 
          rooms_occupied = ?, purpose_of_visit = ?, transportation_mode = ?, 
          status = COALESCE(?, status)
         WHERE id = ?`,
        [
          checkIn,
          checkOut,
          totalGuests,
          roomsOccupied,
          purposeOfVisit,
          transportationMode,
          status || null,
          recordId
        ]
      );
    }

    // Replace all breakdowns
    if (breakdowns !== undefined) {
      await connection.execute(
        `DELETE FROM guest_breakdowns WHERE guest_record_id = ?`,
        [recordId]
      );

      if (breakdowns.length > 0) {
        for (const b of breakdowns) {
          const breakdownId = uuidv4();
          await connection.execute(
            `INSERT INTO guest_breakdowns (
              id, guest_record_id, is_overseas, country, nationality, 
              philippines_region, sex, age_group, count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              breakdownId,
              recordId,
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
    }

    await connection.commit();
    res.json({ message: 'Record updated successfully', updated_at: now.toISOString() });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});
/**
 * GET /api/business/guest-records/:id/updated-at
 * Fetch the last updated timestamp of a guest record
 */
router.get('/guest-records/:id/updated-at', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const recordId = req.params.id;
    const [existing] = await connection.execute(
      `SELECT updated_at FROM guest_records WHERE id = ?`,
      [recordId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Record not found' });
    }
    // Note: if there is no updated_at, fallback to created_at if needed, but assuming table has it or we can return null
    res.json({ updated_at: existing[0].updated_at || null });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
