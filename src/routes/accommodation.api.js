import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import mailer from '../utils/mailer.js';
import { parseDbDate } from '../utils/date.js';

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
      `SELECT b.*,
              (SELECT COUNT(*) FROM rooms WHERE business_id = b.id) AS total_rooms,
              u.full_name, u.email, u.phone,
              DATE(MAX(COALESCE(gr.actual_check_out, CURDATE()))) AS last_activity,
              CASE
                WHEN COUNT(gr.id) = 0 THEN 'no_activity'
                WHEN MAX(COALESCE(gr.actual_check_out, CURDATE())) < DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 'inactive'
                WHEN MAX(COALESCE(gr.actual_check_out, CURDATE())) < DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 'low_activity'
                ELSE 'active'
              END AS activity_status
       FROM businesses b
       JOIN users u ON b.user_id = u.id
       LEFT JOIN guest_records gr
         ON  gr.business_id = b.id
         AND gr.is_deleted  = FALSE
         AND gr.check_in    <= CURDATE()
       WHERE ${whereClause}
       GROUP BY b.id, u.id
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

    // Build date range bounds using local-midnight dates so the period aligns
    // with how check_in/actual_check_out are parsed below. Using date-only
    // strings (new Date("YYYY-MM-01")) parses as UTC midnight, which shifts the
    // effective month window by the timezone offset and mis-attributes records
    // that check in on the 1st of the month (see reports.api.js _parseLocalDate).
    let periodStart, periodEnd;
    if (year !== 0 && month !== 0) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      periodStart = new Date(year, month - 1, 1);
      periodEnd = new Date(nextYear, nextMonth - 1, 1);
    } else if (year !== 0 && month === 0) {
      periodStart = new Date(year, 0, 1);
      periodEnd = new Date(year + 1, 0, 1);
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
      const checkIn = parseDbDate(row.check_in);

      // Actual check-out takes priority; check_out is only the fallback when
      // actual_check_out is null/empty. If neither is present, treat the stay
      // as a same-day stay on the check-in date.
      const effectiveCheckOut = parseDbDate(row.actual_check_out || row.check_out) || new Date(checkIn);

      // The check-out day IS a presence day (check-in Aug 6, check-out Aug 8
      // counts 3 days / 2 nights), so the last presence day is the check-out
      // day itself (same-day stays count their single day).
      const lastPresenceDay = new Date(effectiveCheckOut);
      if (lastPresenceDay < checkIn) lastPresenceDay.setTime(checkIn.getTime());

      let daysInPeriod;
      if (periodStart && periodEnd) {
        const periodLastDay = new Date(periodEnd);
        periodLastDay.setDate(periodLastDay.getDate() - 1); // periodEnd is exclusive
        const stayStart = checkIn < periodStart ? periodStart : checkIn;
        const stayEnd = lastPresenceDay > periodLastDay ? periodLastDay : lastPresenceDay;
        daysInPeriod = stayEnd < stayStart ? 0 : Math.floor((stayEnd - stayStart) / 86400000) + 1;
      } else {
        daysInPeriod = Math.floor((lastPresenceDay - checkIn) / 86400000) + 1;
      }

      if (daysInPeriod <= 0) continue;

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
 * PUT /api/admin/accommodations/:id/status
 * Update a business status (approved/warning/suspended) and notify the owner.
 * Body: { status, reason, messageContent }
 */
router.put('/:id/status', adminGuard, async (req, res, next) => {
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  try {
    const { status, reason, messageContent } = req.body;
    const { id } = req.params;

    if (!['approved', 'warning', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Reason is required.' });
    }
    if (!messageContent || !messageContent.trim()) {
      return res.status(400).json({ message: 'Message content is required.' });
    }

    const [bizRows] = await connection.execute(
      `SELECT b.business_name, u.email
       FROM businesses b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = ?`,
      [id]
    );

    if (bizRows.length === 0) {
      return res.status(404).json({ message: 'Business not found.' });
    }

    const biz = bizRows[0];

    await connection.execute(
      'UPDATE businesses SET status = ? WHERE id = ?',
      [status, id]
    );

    const messageId = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast)
       VALUES (?, ?, 'compliance', 'Business Status Update', ?, FALSE)`,
      [messageId, req.user.id, messageContent.trim()]
    );

    await connection.execute(
      'INSERT INTO message_recipients (message_id, business_id) VALUES (?, ?)',
      [messageId, id]
    );

    await connection.commit();

    res.json({ message: 'Business status updated.' });

    if (biz.email) {
      mailer.sendSystemMessage(biz.email, 'Business Status Update', messageContent.trim(), 'compliance')
        .catch((err) => console.error('Failed to send status-change email:', err.message));
    }
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
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
