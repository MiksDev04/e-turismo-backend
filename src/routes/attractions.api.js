import express from 'express';
import crypto from 'crypto';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import mailer from '../utils/mailer.js';

const router = express.Router();

// All routes require admin authentication
const adminGuard = [auth.authenticate, auth.requireRole('admin')];

/**
 * GET /api/admin/attractions
 * Fetch paginated tourist attractions with joined user profile.
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
    const conditions = ['ta.deleted_at IS NULL'];
    const params     = [];

    if (status && status !== 'all') {
      conditions.push('ta.status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('(ta.attraction_name LIKE ? OR u.full_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total matching rows ─────────────────────────────────────────
    const [countRows] = await db.pool.query(
      `SELECT COUNT(*) as total
       FROM tourist_attractions ta
       JOIN users u ON ta.user_id = u.id
       WHERE ${whereClause}`,
      params
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    // ── Fetch paginated rows ──────────────────────────────────────────────
    const [rows] = await db.pool.query(
      `SELECT ta.*, u.full_name, u.email, u.phone,
              MAX(avl.visit_date) AS last_activity,
              CASE
                WHEN COUNT(avl.id) = 0 THEN 'no_activity'
                WHEN MAX(avl.visit_date) < DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 'inactive'
                WHEN MAX(avl.visit_date) < DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 'low_activity'
                ELSE 'active'
              END AS activity_status
       FROM tourist_attractions ta
       JOIN users u ON ta.user_id = u.id
       LEFT JOIN attraction_visit_logs avl
         ON  avl.attraction_id = ta.id
         AND avl.deleted_at   IS NULL
         AND avl.visit_date   <= CURDATE()
       WHERE ${whereClause}
       GROUP BY ta.id, u.id
       ORDER BY ta.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((row) => {
      const { full_name, email, phone, user_id, attraction_type, ...rest } = row;
      return {
        ...rest,
        user_id,
        profile_id: user_id,
        attraction_type: typeof attraction_type === 'string' ? JSON.parse(attraction_type) : attraction_type,
        profiles: { full_name, email, phone },
      };
    });

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attractions/export
 * Fetch rows for export (limited fields)
 */
router.get('/export', adminGuard, async (req, res, next) => {
  try {
    const [rows] = await db.pool.execute(
      `SELECT ta.attraction_name, ta.attraction_type,
              ta.street, ta.barangay,
              u.full_name, u.phone
       FROM tourist_attractions ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.deleted_at IS NULL
       ORDER BY ta.created_at DESC`
    );

    const data = rows.map((row) => ({
      ...row,
      attraction_type: typeof row.attraction_type === 'string' ? JSON.parse(row.attraction_type) : row.attraction_type,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attractions/rankings
 * Fetch visitor rankings with dense ranking
 * Query params: month (int, 0=all), year (int, 0=all)
 */
router.get('/rankings', adminGuard, async (req, res, next) => {
  try {
    const month = parseInt(req.query.month, 10) || 0;
    const year = parseInt(req.query.year, 10) || 0;

    let query = '';
    const params = [];

    // Build date bounds using local-midnight dates so the period aligns with
    // how visit_date is stored (date-only). Same convention as the
    // accommodation rankings in accommodation.api.js.
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
      query = `SELECT avl.attraction_id, ta.attraction_name, SUM(avl.guest_count) AS total_visitors
               FROM attraction_visit_logs avl
               JOIN tourist_attractions ta ON avl.attraction_id = ta.id
               WHERE avl.deleted_at IS NULL
                 AND avl.visit_date >= ? AND avl.visit_date < ?`;
      params.push(periodStart, periodEnd);
    } else {
      query = `SELECT avl.attraction_id, ta.attraction_name, SUM(avl.guest_count) AS total_visitors
               FROM attraction_visit_logs avl
               JOIN tourist_attractions ta ON avl.attraction_id = ta.id
               WHERE avl.deleted_at IS NULL`;
    }

    query += `
      GROUP BY avl.attraction_id, ta.attraction_name
      HAVING total_visitors > 0`;

    const [rows] = await db.pool.execute(query, params);

    const aggregated = rows.sort((a, b) => b.total_visitors - a.total_visitors);

    // Assign dense ranks
    let currentRank = 0;
    let prevTotal = null;
    const data = aggregated.map((item) => {
      if (item.total_visitors !== prevTotal) {
        currentRank++;
        prevTotal = item.total_visitors;
      }
      return {
        attraction_id: item.attraction_id,
        attraction_name: item.attraction_name,
        total_visitors: Number(item.total_visitors),
        rank: currentRank,
      };
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/attractions/:id/approve
 * Approve an attraction
 */
router.put('/:id/approve', adminGuard, async (req, res, next) => {
  try {
    const { remarks } = req.body;
    await db.pool.execute(
      'UPDATE tourist_attractions SET status = ?, remarks = ? WHERE id = ?',
      ['approved', remarks || null, req.params.id]
    );
    res.json({ message: 'Attraction approved.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/attractions/:id/reject
 * Reject an attraction
 */
router.put('/:id/reject', adminGuard, async (req, res, next) => {
  try {
    const { remarks } = req.body;
    await db.pool.execute(
      'UPDATE tourist_attractions SET status = ?, remarks = ? WHERE id = ?',
      ['rejected', remarks || null, req.params.id]
    );
    res.json({ message: 'Attraction rejected.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/attractions/:id/flag
 * Flag/warn an attraction
 */
router.put('/:id/flag', adminGuard, async (req, res, next) => {
  try {
    const { remarks } = req.body;
    await db.pool.execute(
      'UPDATE tourist_attractions SET status = ?, remarks = ? WHERE id = ?',
      ['warning', remarks || null, req.params.id]
    );
    res.json({ message: 'Attraction flagged.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/attractions/:id/status
 * Update an attraction status (approved/warning) and notify the owner.
 * Body: { status, reason, messageContent }
 */
router.put('/:id/status', adminGuard, async (req, res, next) => {
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  try {
    const { status, reason, messageContent } = req.body;
    const { id } = req.params;

    if (!['approved', 'warning'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'Reason is required.' });
    }
    if (!messageContent || !messageContent.trim()) {
      return res.status(400).json({ message: 'Message content is required.' });
    }

    const [attRows] = await connection.execute(
      `SELECT ta.attraction_name, u.email
       FROM tourist_attractions ta
       JOIN users u ON ta.user_id = u.id
       WHERE ta.id = ?`,
      [id]
    );

    if (attRows.length === 0) {
      return res.status(404).json({ message: 'Attraction not found.' });
    }

    const att = attRows[0];

    await connection.execute(
      'UPDATE tourist_attractions SET status = ? WHERE id = ?',
      [status, id]
    );

    const messageId = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO messages (id, sender_id, message_type, subject, content, is_broadcast)
       VALUES (?, ?, 'compliance', 'Business Status Update', ?, FALSE)`,
      [messageId, req.user.id, messageContent.trim()]
    );

    await connection.execute(
      'INSERT INTO message_recipients (message_id, attraction_id) VALUES (?, ?)',
      [messageId, id]
    );

    await connection.commit();

    res.json({ message: 'Attraction status updated.' });

    if (att.email) {
      mailer.sendSystemMessage(att.email, 'Business Status Update', messageContent.trim(), 'compliance')
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
 * DELETE /api/admin/attractions/:id
 * Soft delete an attraction
 */
router.delete('/:id', adminGuard, async (req, res, next) => {
  try {
    await db.pool.execute(
      'UPDATE tourist_attractions SET deleted_at = NOW() WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: 'Attraction deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;
