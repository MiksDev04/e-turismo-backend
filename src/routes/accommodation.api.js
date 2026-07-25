import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// All routes require admin authentication
const adminGuard = [auth.authenticate, auth.requireRole('admin')];

/**
 * GET /api/admin/accommodations
 * Fetch paginated businesses with joined user profile.
 * Query params: page, pageSize, status, search
 */
router.get('/', adminGuard, async (req, res, next) => {
  try {
    const {
      page = '1',
      pageSize = '10',
      status,
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    // ── Build WHERE clause ────────────────────────────────────────────────
    const conditions = ['b.deleted_at IS NULL'];
    const params     = [];

    if (status && status !== 'all') {
      conditions.push('b.status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('(b.business_name LIKE ? OR u.full_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total matching rows ─────────────────────────────────────────
    const [countRows] = await db.pool.query(
      `SELECT COUNT(*) as total
       FROM businesses b
       JOIN users u ON b.user_id = u.id
       WHERE ${whereClause}`,
      params
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    // ── Fetch paginated rows ──────────────────────────────────────────────
    const [rows] = await db.pool.query(
      `SELECT b.*, (SELECT COUNT(*) FROM rooms WHERE business_id = b.id) AS total_rooms, u.full_name, u.email, u.phone
       FROM businesses b
       JOIN users u ON b.user_id = u.id
       WHERE ${whereClause}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((row) => {
      const { full_name, email, phone, user_id, business_line, ...rest } = row;
      return {
        ...rest,
        user_id,
        profile_id: user_id,
        business_line: typeof business_line === 'string' ? JSON.parse(business_line) : business_line,
        profiles: { full_name, email, phone },
      };
    });

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/accommodations/export
 * Fetch rows for export (limited fields)
 */
router.get('/export', adminGuard, async (req, res, next) => {
  try {
    const [rows] = await db.pool.execute(
      `SELECT b.business_name, b.tradename, b.business_line, b.business_type,
              b.owner_first_name, b.owner_middle_name, b.owner_last_name,
              b.street, b.region, b.province, b.city_municipality, b.barangay,
              u.phone
       FROM businesses b
       JOIN users u ON b.user_id = u.id
       WHERE b.deleted_at IS NULL
       ORDER BY b.created_at DESC`
    );

    const data = rows.map((row) => ({
      ...row,
      business_line: typeof row.business_line === 'string' ? JSON.parse(row.business_line) : row.business_line,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/accommodations/rankings
 * Fetch tourist rankings with dense ranking
 * Query params: month (int, 0=all), year (int, 0=all)
 */
router.get('/rankings', adminGuard, async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10) || 0;
    const year = parseInt(req.query.year, 10) || 0;

    let query = '';
    const params = [];

    // Build date range bounds
    let periodStart, periodEnd;
    if (year !== 0 && month !== 0) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      periodStart = new Date(`${year}-${String(month).padStart(2, '0')}-01`);
      periodEnd = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`);
    } else if (year !== 0 && month === 0) {
      periodStart = new Date(`${year}-01-01`);
      periodEnd = new Date(`${year + 1}-01-01`);
    } else {
      periodStart = null;
      periodEnd = null;
    }

    if (periodStart && periodEnd) {
      query = `SELECT gr.business_id, b.business_name, gr.check_in, gr.check_out, gr.actual_check_out, gr.total_guests
               FROM guest_records gr
               JOIN businesses b ON gr.business_id = b.id
               WHERE gr.is_deleted = false
                 AND gr.check_in < ? AND COALESCE(gr.actual_check_out, gr.check_out) >= ?`;
      params.push(periodEnd, periodStart);
    } else {
      query = `SELECT gr.business_id, b.business_name, gr.check_in, gr.check_out, gr.actual_check_out, gr.total_guests
               FROM guest_records gr
               JOIN businesses b ON gr.business_id = b.id
               WHERE gr.is_deleted = false`;
    }

    const [rows] = await db.pool.execute(query, params);

    const map = new Map();

    for (const row of rows) {
      const checkInRaw = new Date(row.check_in);
      const effectiveCheckOutRaw = new Date(row.actual_check_out || row.check_out);
      const checkIn = new Date(checkInRaw.getFullYear(), checkInRaw.getMonth(), checkInRaw.getDate());
      const effectiveCheckOut = new Date(effectiveCheckOutRaw.getFullYear(), effectiveCheckOutRaw.getMonth(), effectiveCheckOutRaw.getDate());

      let daysInPeriod;
      if (periodStart && periodEnd) {
        const stayStart = checkIn < periodStart ? periodStart : checkIn;
        const stayEnd = effectiveCheckOut > periodEnd ? periodEnd : effectiveCheckOut;
        daysInPeriod = Math.max(1, Math.floor((stayEnd - stayStart) / 86400000));
      } else {
        daysInPeriod = Math.max(1, Math.floor((effectiveCheckOut - checkIn) / 86400000));
      }

      const guestDays = Number(row.total_guests) * daysInPeriod;
      const key = row.business_id;
      if (map.has(key)) {
        map.get(key).total_guests += guestDays;
      } else {
        map.set(key, {
          business_id: row.business_id,
          business_name: row.business_name,
          total_guests: guestDays,
        });
      }
    }

    const aggregated = Array.from(map.values()).sort((a, b) => b.total_guests - a.total_guests);

    // Assign dense ranks
    let currentRank = 0;
    let prevTotal = null;
    const data = aggregated.map((item) => {
      if (item.total_guests !== prevTotal) {
        currentRank++;
        prevTotal = item.total_guests;
      }
      return { ...item, rank: currentRank };
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/accommodations/:id/rooms
 * Fetch individual rooms for a business
 */
router.get('/:id/rooms', adminGuard, async (req, res, next) => {
  try {
    const [rows] = await db.pool.execute(
      `SELECT room_number, capacity, room_status
       FROM rooms
       WHERE business_id = ?
       ORDER BY room_number`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/accommodations/:id/approve
 * Approve a business
 */
router.put('/:id/approve', adminGuard, async (req, res, next) => {
  try {
    const { remarks } = req.body;
    await db.pool.execute(
      'UPDATE businesses SET status = ?, remarks = ? WHERE id = ?',
      ['approved', remarks || null, req.params.id]
    );
    res.json({ message: 'Business approved.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/accommodations/:id/reject
 * Reject a business
 */
router.put('/:id/reject', adminGuard, async (req, res, next) => {
  try {
    const { remarks } = req.body;
    await db.pool.execute(
      'UPDATE businesses SET status = ?, remarks = ? WHERE id = ?',
      ['rejected', remarks || null, req.params.id]
    );
    res.json({ message: 'Business rejected.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/accommodations/:id/flag
 * Flag/warn a business
 */
router.put('/:id/flag', adminGuard, async (req, res, next) => {
  try {
    const { remarks } = req.body;
    await db.pool.execute(
      'UPDATE businesses SET status = ?, remarks = ? WHERE id = ?',
      ['warning', remarks || null, req.params.id]
    );
    res.json({ message: 'Business flagged.' });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/accommodations/:id
 * Soft delete a business
 */
router.delete('/:id', adminGuard, async (req, res, next) => {
  try {
    await db.pool.execute(
      'UPDATE businesses SET deleted_at = NOW() WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: 'Business deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;
