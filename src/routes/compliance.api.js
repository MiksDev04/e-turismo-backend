import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import mailer from '../utils/mailer.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * GET /api/admin/compliance/activity-summary
 * Admin only: Fetches paginated business activity metrics.
 * Query params: page, pageSize, searchQuery, activityStatus, businessStatus, businessLine
 */
router.get('/activity-summary', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      page = '1',
      pageSize = '10',
      searchQuery,
      activityStatus,
      businessStatus,
      businessLine,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    // ── Build WHERE + HAVING clauses ──────────────────────────────────────
    const whereConditions = ["b.status IN ('approved', 'warning')", 'b.deleted_at IS NULL'];
    const whereParams     = [];

    if (businessStatus && businessStatus !== 'all' && businessStatus !== 'All Business Statuses') {
      whereConditions.push('b.status = ?');
      whereParams.push(businessStatus.toLowerCase());
    }

    const havingConditions = [];
    const havingParams     = [];

    if (searchQuery) {
      havingConditions.push('b.business_name LIKE ?');
      havingParams.push(`%${searchQuery}%`);
    }

    if (activityStatus && activityStatus !== 'all' && activityStatus !== 'All Statuses') {
      const statusMap = {
        'active': 'active',
        'low activity': 'low_activity',
        'inactive': 'inactive',
        'no activity': 'no_activity',
      };
      const mapped = statusMap[activityStatus.toLowerCase()];
      if (mapped) {
        havingConditions.push(`CASE
          WHEN COUNT(gr.id) = 0 THEN 'no_activity'
          WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'inactive'
          WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'low_activity'
          ELSE 'active'
        END = ?`);
        havingParams.push(mapped);
      }
    }

    const whereClause  = whereConditions.join(' AND ');
    const havingClause = havingConditions.length > 0
      ? 'HAVING ' + havingConditions.join(' AND ')
      : '';

    // ── Count total matching rows ─────────────────────────────────────────
    const countSql = `
      SELECT COUNT(*) as total FROM (
        SELECT b.id
        FROM businesses b
        LEFT JOIN guest_records gr
          ON  gr.business_id = b.id
          AND gr.is_deleted  = FALSE
        WHERE ${whereClause}
        GROUP BY b.id, b.business_name, b.status
        ${havingClause}
      ) cnt`;

    const [countRows] = await connection.query(countSql, [...whereParams, ...havingParams]);
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0, summaryCounts: { active: 0, lowActivity: 0, inactive: 0 } });
    }

    // ── Fetch summary counts (unfiltered by pagination) ───────────────────
    const [summaryRows] = await connection.query(`
      SELECT activity_status, COUNT(*) AS cnt
      FROM (
        SELECT
          CASE
            WHEN COUNT(gr.id) = 0 THEN 'no_activity'
            WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 'inactive'
            WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 'low_activity'
            ELSE 'active'
          END AS activity_status
        FROM businesses b
        LEFT JOIN guest_records gr
          ON  gr.business_id = b.id
          AND gr.is_deleted  = FALSE
        WHERE b.status IN ('approved', 'warning')
          AND b.deleted_at IS NULL
        GROUP BY b.id
      ) sub
      GROUP BY activity_status
    `);

    const summaryCounts = { active: 0, lowActivity: 0, inactive: 0 };
    for (const row of summaryRows) {
      if (row.activity_status === 'active') summaryCounts.active = row.cnt;
      else if (row.activity_status === 'low_activity') summaryCounts.lowActivity = row.cnt;
      else summaryCounts.inactive = (summaryCounts.inactive || 0) + row.cnt;
    }

    // ── Fetch paginated rows ──────────────────────────────────────────────
    const sql = `
      SELECT
        b.id,
        b.business_name,
        b.business_line,
        b.status                              AS business_status,
        COUNT(gr.id)                          AS total_records,
        MAX(gr.created_at)                    AS last_activity,
        CASE
          WHEN COUNT(gr.id) = 0
               THEN 'no_activity'
          WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 30 DAY)
               THEN 'inactive'
          WHEN MAX(gr.created_at) < DATE_SUB(NOW(), INTERVAL 7 DAY)
               THEN 'low_activity'
          ELSE 'active'
        END                                   AS activity_status
      FROM businesses b
      LEFT JOIN guest_records gr
        ON  gr.business_id = b.id
        AND gr.is_deleted  = FALSE
      WHERE ${whereClause}
      GROUP BY
        b.id,
        b.business_name,
        b.status
      ${havingClause}
      ORDER BY last_activity DESC
      LIMIT ? OFFSET ?`;

    const [rows] = await connection.query(sql, [...whereParams, ...havingParams, limit, offset]);

    // Compute guest-days (spread) for each business
    const businessIds = rows.map(r => r.id);
    let guestDaysMap = new Map();
    if (businessIds.length > 0) {
      const placeholders = businessIds.map(() => '?').join(',');
      const [guestRows] = await connection.query(
        `SELECT business_id, check_in, check_out, actual_check_out, total_guests
         FROM guest_records
         WHERE business_id IN (${placeholders}) AND is_deleted = FALSE`,
        businessIds
      );
      for (const gr of guestRows) {
        const checkInRaw = new Date(gr.check_in);
        const effectiveCheckOutRaw = new Date(gr.actual_check_out || gr.check_out);
        const checkIn = new Date(checkInRaw.getFullYear(), checkInRaw.getMonth(), checkInRaw.getDate());
        const effectiveCheckOut = new Date(effectiveCheckOutRaw.getFullYear(), effectiveCheckOutRaw.getMonth(), effectiveCheckOutRaw.getDate());
        const nights = Math.max(1, Math.floor((effectiveCheckOut - checkIn) / 86400000));
        const guestDays = Number(gr.total_guests) * nights;
        guestDaysMap.set(gr.business_id, (guestDaysMap.get(gr.business_id) || 0) + guestDays);
      }
    }

    const data = rows.map(r => ({
      ...r,
      total_records: Number(r.total_records),
      total_guests: guestDaysMap.get(r.id) || 0
    }));

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit), summaryCounts });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * PUT /api/admin/compliance/business-status/:businessId
 * Admin only: Updates the status of a business.
 */
router.put('/business-status/:businessId', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  try {
    const { status, reason, messageContent } = req.body;
    const { businessId } = req.params;

    if (!['approved', 'warning', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Reason is required' });
    }
    if (!messageContent || !messageContent.trim()) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const [bizRows] = await connection.execute(
      `SELECT b.business_name, b.status AS old_status,
              u.email
       FROM businesses b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = ?`,
      [businessId]
    );

    if (bizRows.length === 0) {
      return res.status(404).json({ message: 'Business not found' });
    }

    const biz = bizRows[0];

    await connection.execute(
      'UPDATE businesses SET status = ? WHERE id = ?',
      [status, businessId]
    );

    const messageId = crypto.randomUUID();
    await connection.execute(
      'INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast) VALUES (?, ?, ?, ?, ?, ?)',
      [messageId, req.user.id, 'compliance', 'Business Status Update', messageContent.trim(), false]
    );

    await connection.execute(
      'INSERT INTO message_recipients (message_id, business_id) VALUES (?, ?)',
      [messageId, businessId]
    );

    await connection.commit();

    res.json({ message: 'Business status updated' });

    if (biz.email) {
      mailer.sendSystemMessage(biz.email, 'Business Status Update', messageContent.trim(), 'compliance')
        .catch(err => console.error('Failed to send status-change email:', err.message));
    }
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/admin/compliance/daily-stats/:businessId
 * Admin only: Fetches aggregated guest totals per day for a business.
 */
router.get('/daily-stats/:businessId', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { businessId } = req.params;
    const { month, year } = req.query;

    const m = parseInt(month);
    const y = parseInt(year);

    if (isNaN(m) || isNaN(y)) {
      return res.status(400).json({ message: 'Valid month and year are required' });
    }

    const startStr = `${y}-${m.toString().padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endStr = `${y}-${m.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;

    // Fetch all records that overlap with the target month
    const [rows] = await connection.execute(
      `SELECT check_in, check_out, actual_check_out, total_guests
       FROM guest_records
       WHERE business_id = ? AND is_deleted = FALSE
         AND check_in <= ? AND COALESCE(actual_check_out, check_out) >= ?`,
      [businessId, endStr, startStr]
    );

    // Build per-day map: day-of-month → total guest-days present
    const periodStart = new Date(y, m - 1, 1);
    const periodEnd = new Date(y, m - 1, lastDay);
    const dayMap = new Map();
    for (let d = 1; d <= lastDay; d++) {
      dayMap.set(d, 0);
    }

    for (const row of rows) {
      const checkInRaw = new Date(row.check_in);
      const effectiveCheckOutRaw = new Date(row.actual_check_out || row.check_out);
      const checkIn = new Date(checkInRaw.getFullYear(), checkInRaw.getMonth(), checkInRaw.getDate());
      const effectiveCheckOut = new Date(effectiveCheckOutRaw.getFullYear(), effectiveCheckOutRaw.getMonth(), effectiveCheckOutRaw.getDate());
      const guests = Number(row.total_guests);

      // Clamp stay to the target month
      const stayStart = checkIn < periodStart ? periodStart : checkIn;
      const stayEnd = effectiveCheckOut > periodEnd ? periodEnd : effectiveCheckOut;
      const isClamped = effectiveCheckOut > periodEnd;

      if (stayEnd < stayStart) continue;

      // Determine last PRESENCE day (checkout day is NOT a presence day)
      const isSameDay = effectiveCheckOut.getTime() <= checkIn.getTime();
      let lastPresenceDay;
      if (isClamped) {
        lastPresenceDay = stayEnd;
      } else if (isSameDay) {
        lastPresenceDay = checkIn;
      } else {
        lastPresenceDay = new Date(effectiveCheckOut);
        lastPresenceDay.setDate(lastPresenceDay.getDate() - 1);
      }

      // Add 1 guest-day for each day the guest was present
      const cur = new Date(stayStart);
      while (cur <= lastPresenceDay) {
        const dayOfMonth = cur.getDate();
        if (dayMap.has(dayOfMonth)) {
          dayMap.set(dayOfMonth, dayMap.get(dayOfMonth) + guests);
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    const result = [];
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      result.push({ check_in: dateStr, total_guests: dayMap.get(d) });
    }

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
