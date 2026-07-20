import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/business/rooms
 * Fetch rooms for a business with optional pagination, filters.
 * Query: businessId, page, pageSize, fetchAll, status, search
 * Without fetchAll — returns { data, totalCount, pageCount }.
 * With fetchAll=true — returns { data } (backward compat for guest-entry).
 */
router.get('/rooms', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      businessId,
      page = '1',
      pageSize = '10',
      fetchAll,
      status,
      search,
    } = req.query;

    if (!businessId) {
      return res.status(400).json({ message: 'Missing businessId parameter' });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    // ── Build WHERE clause ────────────────────────────────────────────────
    const conditions = ['business_id = ?'];
    const params     = [businessId];

    if (status && status !== 'All') {
      conditions.push('room_status = ?');
      params.push(status);
    }

    if (search && search.trim()) {
      conditions.push('room_number LIKE ?');
      params.push(`%${search.trim()}%`);
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total matching rows ─────────────────────────────────────────
    let totalCount = 0;
    if (fetchAll !== 'true') {
      const [countRows] = await connection.query(
        `SELECT COUNT(*) as total FROM rooms WHERE ${whereClause}`,
        params
      );
      totalCount = countRows[0].total;

      if (totalCount === 0) {
        return res.json({ data: [], totalCount: 0, pageCount: 0 });
      }
    }

    // ── Fetch rooms ──────────────────────────────────────────────────────
    let query = `SELECT id, room_number, capacity, room_status, created_at, updated_at
                 FROM rooms
                 WHERE ${whereClause}
                 ORDER BY room_number`;
    const queryParams = [...params];
    if (fetchAll !== 'true') {
      query += ' LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);
    }
    const [rows] = await connection.query(query, queryParams);

    const data = rows.map(r => ({
      id: r.id,
      roomNumber: r.room_number,
      capacity: r.capacity,
      roomStatus: r.room_status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    if (fetchAll === 'true') {
      return res.json({ data });
    }
    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * POST /api/business/rooms
 * Create a new room for a business.
 */
router.post('/rooms', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  try {
    const { id, businessId, roomNumber, capacity } = req.body;

    if (!businessId || !roomNumber) {
      return res.status(400).json({ message: 'Missing required fields: businessId, roomNumber' });
    }

    const roomId = id || uuidv4();
    const roomCapacity = Math.max(1, parseInt(capacity, 10) || 1);

    const connection = await db.pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        `INSERT INTO rooms (id, business_id, room_number, capacity, room_status)
         VALUES (?, ?, ?, ?, 'vacant')`,
        [roomId, businessId, roomNumber.trim(), roomCapacity]
      );

      await connection.execute(
        `UPDATE businesses SET total_rooms = total_rooms + 1 WHERE id = ?`,
        [businessId]
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const [created] = await db.pool.execute(
      `SELECT id, room_number, capacity, room_status, created_at FROM rooms WHERE id = ?`,
      [roomId]
    );

    res.status(201).json({
      message: 'Room created successfully',
      room: {
        id: created[0].id,
        roomNumber: created[0].room_number,
        capacity: created[0].capacity,
        roomStatus: created[0].room_status,
        createdAt: created[0].created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/business/rooms/:id
 * Update room details (room_number, capacity).
 */
router.put('/rooms/:id', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  try {
    const roomId = req.params.id;
    const { roomNumber, capacity } = req.body;

    if (!roomNumber && capacity === undefined) {
      return res.status(400).json({ message: 'Nothing to update — provide roomNumber or capacity' });
    }

    const [existing] = await db.pool.execute(
      `SELECT id FROM rooms WHERE id = ?`,
      [roomId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const updates = [];
    const params = [];

    if (roomNumber) {
      updates.push('room_number = ?');
      params.push(roomNumber.trim());
    }
    if (capacity !== undefined) {
      updates.push('capacity = ?');
      params.push(Math.max(1, parseInt(capacity, 10) || 1));
    }

    params.push(roomId);
    await db.pool.execute(
      `UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [updated] = await db.pool.execute(
      `SELECT id, room_number, capacity, room_status, created_at, updated_at FROM rooms WHERE id = ?`,
      [roomId]
    );

    res.json({
      message: 'Room updated successfully',
      room: {
        id: updated[0].id,
        roomNumber: updated[0].room_number,
        capacity: updated[0].capacity,
        roomStatus: updated[0].room_status,
        createdAt: updated[0].created_at,
        updatedAt: updated[0].updated_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/business/rooms/:id/status
 * Change room_status (vacant/occupied).
 */
router.put('/rooms/:id/status', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  try {
    const roomId = req.params.id;
    const { roomStatus } = req.body;

    if (!roomStatus || !['vacant', 'occupied', 'unavailable', 'reserved'].includes(roomStatus)) {
      return res.status(400).json({ message: 'roomStatus must be "vacant", "occupied", "unavailable", or "reserved"' });
    }

    const [existing] = await db.pool.execute(
      `SELECT id FROM rooms WHERE id = ?`,
      [roomId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    await db.pool.execute(
      `UPDATE rooms SET room_status = ? WHERE id = ?`,
      [roomStatus, roomId]
    );

    res.json({ message: 'Room status updated', roomStatus });
  } catch (err) {
    next(err);
  }
});

export default router;
