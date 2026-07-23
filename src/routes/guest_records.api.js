import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/business/guest-records
 * Fetch paginated guest records for a business with optional filters.
 * Query params: businessId, page, pageSize, status, checkInFrom, checkOutTo,
 *               purpose, transport
 */
router.get('/guest-records', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      businessId,
      page = '1',
      pageSize = '10',
      fetchAll,
      status,
      checkInFrom,
      checkOutTo,
      purpose,
      transport,
      lastSync,
    } = req.query;

    if (!businessId) {
      return res.status(400).json({ message: 'Missing businessId parameter' });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    const isDeltaSync = !!lastSync;

    // ── Build WHERE clause ────────────────────────────────────────────────
    // When lastSync is provided (delta sync), we need to include soft-deleted
    // records (is_deleted=TRUE) so the client can detect and prune them.
    // We also skip status filtering to return all changed records.
    const conditions = ['gr.business_id = ?'];
    const params     = [businessId];

    if (isDeltaSync) {
      conditions.push('gr.updated_at > ?');
      params.push(lastSync);
    } else {
      conditions.push('gr.is_deleted = FALSE');

      if (status === 'archived') {
        conditions.push("gr.status = 'archived'");
      } else {
        conditions.push("gr.status = 'active'");
      }
    }

    if (checkInFrom) {
      conditions.push('gr.check_in >= ?');
      params.push(checkInFrom);
    }
    if (checkOutTo) {
      conditions.push('gr.check_out <= ?');
      params.push(checkOutTo);
    }
    if (purpose && purpose !== 'All') {
      conditions.push('gr.purpose_of_visit = ?');
      params.push(purpose);
    }
    if (transport && transport !== 'All') {
      conditions.push('gr.transportation_mode = ?');
      params.push(transport);
    }
    const whereClause = conditions.join(' AND ');

    // ── Count total matching rows ─────────────────────────────────────────
    let totalCount = 0;
    if (fetchAll !== 'true') {
      const [countRows] = await connection.query(
        `SELECT COUNT(*) as total FROM guest_records gr WHERE ${whereClause}`,
        params
      );
      totalCount = countRows[0].total;

      if (totalCount === 0) {
        return res.json({ data: [], totalCount: 0, pageCount: 0 });
      }
    }

    // ── Fetch guest records with lead guest fields ───────────────────────
    let query = `SELECT gr.id, gr.business_id, gr.check_in, gr.check_out,
                        gr.actual_check_out,
                        gr.length_of_stay, gr.total_guests,
                        gr.purpose_of_visit, gr.transportation_mode,
                        gr.lead_country, gr.lead_city_municipality, gr.lead_province,
                        gr.lead_nationality, gr.lead_philippines_region, gr.lead_is_overseas,
                        gr.lead_birthdate, gr.lead_sex,
                        gr.status, gr.is_deleted, gr.created_at, gr.updated_at
                 FROM guest_records gr
                 WHERE ${whereClause}
                 ORDER BY gr.updated_at ASC`;
    const queryParams = [...params];
    if (fetchAll !== 'true') {
      query += ' LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);
    }
    const [records] = await connection.query(query, queryParams);

    // ── Fetch rooms for these records via junction table ─────────────────
    const recordIds = records.map(r => r.id);
    let roomsByRecord = {};

    if (recordIds.length > 0) {
      const placeholders = recordIds.map(() => '?').join(',');
      const [roomLinks] = await connection.execute(
        `SELECT grr.guest_record_id, r.id AS room_id, r.room_number, r.capacity, grr.status AS link_status
         FROM guest_record_rooms grr
         JOIN rooms r ON r.id = grr.room_id
         WHERE grr.guest_record_id IN (${placeholders})`,
        recordIds
      );

      for (const rl of roomLinks) {
        if (!roomsByRecord[rl.guest_record_id]) {
          roomsByRecord[rl.guest_record_id] = [];
        }
        roomsByRecord[rl.guest_record_id].push({
          id: rl.room_id,
          roomNumber: rl.room_number,
          capacity: rl.capacity,
          status: rl.link_status,
        });
      }
    }

    const data = records.map(r => ({
      ...r,
      leadIsOverseas: r.lead_is_overseas === 1,
      isDeleted: r.is_deleted === 1 || r.is_deleted === true,
      rooms: roomsByRecord[r.id] || [],
    }));

    if (fetchAll === 'true') {
      return res.json(data);
    }
    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/business/guest-records/:id
 * Updates a guest record, room assignments, and room statuses
 */
router.put('/guest-records/:id', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const recordId = req.params.id;
    const {
      checkIn,
      checkOut,
      actualCheckOut,
      totalGuests,
      roomIds,
      purposeOfVisit,
      transportationMode,
      status,
      businessId,
      leadCountry,
      leadMunicipality,
      leadProvince,
      leadNationality,
      leadPhilippinesRegion,
      leadIsOverseas,
      leadBirthdate,
      leadSex,
    } = req.body;

    if (!leadSex || !['male', 'female'].includes(leadSex?.toLowerCase())) {
      return res.status(400).json({ message: 'leadSex must be "male" or "female"' });
    }

    await connection.beginTransaction();

    const lengthOfStay = Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)));

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
          id, business_id, check_in, check_out, actual_check_out, length_of_stay, total_guests,
          purpose_of_visit, transportation_mode,
          lead_country, lead_city_municipality, lead_province,
          lead_nationality, lead_philippines_region, lead_is_overseas,
          lead_birthdate, lead_sex,
          status, is_deleted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
        [
          recordId,
          businessId,
          checkIn,
          checkOut,
          actualCheckOut || null,
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
          status || 'active',
          now
        ]
      );

      // Create junction rows when roomIds are provided (mirrors POST handler logic).
      // This handles the case where a record was created offline (syncPendingCreate)
      // and the PUT arrives before the POST — the upsert creates the record and
      // its room associations so the checkout handler can process them.
      if (roomIds && roomIds.length > 0) {
        const junctionStatus = actualCheckOut ? 'completed' : 'active';
        for (const roomId of roomIds) {
          const junctionId = uuidv4();
          await connection.execute(
            `INSERT INTO guest_record_rooms (id, guest_record_id, room_id, status) VALUES (?, ?, ?, ?)`,
            [junctionId, recordId, roomId, junctionStatus]
          );
        }
        // Only mark rooms occupied if NOT already checked out
        if (!actualCheckOut) {
          const placeholders = roomIds.map(() => '?').join(',');
          await connection.execute(
            `UPDATE rooms SET room_status = 'occupied' WHERE id IN (${placeholders})`,
            roomIds
          );
        }
      }
    } else {
      // Update existing
      const updateFields = [
        `check_in = ?`, `check_out = ?`, `length_of_stay = ?`, `total_guests = ?`,
        `purpose_of_visit = ?`, `transportation_mode = ?`,
        `lead_country = ?`, `lead_city_municipality = ?`, `lead_province = ?`,
        `lead_nationality = ?`, `lead_philippines_region = ?`, `lead_is_overseas = ?`,
        `lead_birthdate = ?`, `lead_sex = ?`,
        `status = COALESCE(?, status)`,
      ];
      const updateParams = [
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
        status || null,
      ];

      if (actualCheckOut !== undefined) {
        updateFields.push(`actual_check_out = ?`);
        updateParams.push(actualCheckOut || null);
      }

      updateParams.push(recordId);
      await connection.execute(
        `UPDATE guest_records SET ${updateFields.join(', ')} WHERE id = ?`,
        updateParams
      );
    }

    // ── Handle room assignment changes ──────────────────────────────────
    const isCheckout = actualCheckOut !== undefined && actualCheckOut !== null;

    if (isCheckout) {
      // Checkout — always free rooms and mark active junctions as completed.
      const [activeLinks] = await connection.execute(
        `SELECT room_id FROM guest_record_rooms WHERE guest_record_id = ? AND status = 'active'`,
        [recordId]
      );

      if (activeLinks.length > 0) {
        const activeRoomIds = activeLinks.map(l => l.room_id);
        const placeholders = activeRoomIds.map(() => '?').join(',');

        // Set rooms back to vacant
        await connection.execute(
          `UPDATE rooms SET room_status = 'vacant' WHERE id IN (${placeholders}) AND room_status = 'occupied'`,
          activeRoomIds
        );

        // Mark junction rows as completed (preserved as history)
        await connection.execute(
          `UPDATE guest_record_rooms SET status = 'completed' WHERE guest_record_id = ? AND status = 'active'`,
          [recordId]
        );
      }
    } else if (roomIds !== undefined) {
      // Normal edit (no checkout) — reassign rooms
      const [oldLinks] = await connection.execute(
        `SELECT room_id FROM guest_record_rooms WHERE guest_record_id = ? AND status = 'active'`,
        [recordId]
      );

      if (oldLinks.length > 0) {
        const oldRoomIds = oldLinks.map(l => l.room_id);
        const placeholders = oldRoomIds.map(() => '?').join(',');

        // Set old rooms back to vacant
        await connection.execute(
          `UPDATE rooms SET room_status = 'vacant' WHERE id IN (${placeholders}) AND room_status = 'occupied'`,
          oldRoomIds
        );

        // Mark removed rooms as completed (preserve history)
        const removedIds = oldRoomIds.filter(id => !roomIds.includes(id));
        if (removedIds.length > 0) {
          const removedPlaceholders = removedIds.map(() => '?').join(',');
          await connection.execute(
            `UPDATE guest_record_rooms SET status = 'completed' WHERE guest_record_id = ? AND room_id IN (${removedPlaceholders}) AND status = 'active'`,
            [recordId, ...removedIds]
          );
        }
      }

      // Insert new room assignments as active
      if (roomIds.length > 0) {
        for (const roomId of roomIds) {
          // Check if a completed link already exists for this room
          const [existingLink] = await connection.execute(
            `SELECT id, status FROM guest_record_rooms WHERE guest_record_id = ? AND room_id = ?`,
            [recordId, roomId]
          );

          if (existingLink.length > 0) {
            // Reactivate if it was completed
            if (existingLink[0].status === 'completed') {
              await connection.execute(
                `UPDATE guest_record_rooms SET status = 'active' WHERE guest_record_id = ? AND room_id = ?`,
                [recordId, roomId]
              );
            }
          } else {
            const junctionId = uuidv4();
            await connection.execute(
              `INSERT INTO guest_record_rooms (id, guest_record_id, room_id, status) VALUES (?, ?, ?, 'active')`,
              [junctionId, recordId, roomId]
            );
          }
        }

        const placeholders = roomIds.map(() => '?').join(',');
        await connection.execute(
          `UPDATE rooms SET room_status = 'occupied' WHERE id IN (${placeholders})`,
          roomIds
        );
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
 * DELETE /api/business/guest-records/:id
 * Soft-delete a guest record (sets is_deleted = TRUE).
 * This bumps updated_at so delta sync clients can detect the deletion.
 */
router.delete('/guest-records/:id', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const recordId = req.params.id;

    const [existing] = await connection.execute(
      `SELECT id, is_deleted FROM guest_records WHERE id = ?`,
      [recordId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Record not found' });
    }

    if (existing[0].is_deleted) {
      return res.json({ message: 'Record already soft-deleted', id: recordId });
    }

    await connection.execute(
      `UPDATE guest_records SET is_deleted = TRUE WHERE id = ?`,
      [recordId]
    );

    res.json({ message: 'Record soft-deleted successfully', id: recordId });
  } catch (err) {
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
    res.json({ updated_at: existing[0].updated_at || null });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
