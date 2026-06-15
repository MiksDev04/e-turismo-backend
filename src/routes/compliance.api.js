import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/admin/compliance/activity-summary
 * Admin only: Fetches business activity metrics.
 */
router.get('/activity-summary', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    // Grouping by non-JSON columns only to avoid MySQL ER_JSON_USED_AS_KEY errors.
    // CAST(total_records AS SIGNED) etc. doesn't help with JSON serialization in JS,
    // so we convert to Number manually in map.
    const [rows] = await connection.execute(`
      SELECT
        b.id,
        b.business_name,
        b.business_line,
        b.status                              AS business_status,
        COUNT(gr.id)                          AS total_records,
        COALESCE(SUM(gr.total_guests), 0)     AS total_guests,
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
      WHERE b.status     IN ('approved', 'warning')
        AND b.deleted_at IS NULL
      GROUP BY
        b.id,
        b.business_name,
        b.status
      ORDER BY last_activity DESC
    `);

    const result = rows.map(r => ({
      ...r,
      total_records: Number(r.total_records),
      total_guests: Number(r.total_guests)
    }));

    res.json(result);
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
  try {
    const { status } = req.body;
    const { businessId } = req.params;

    if (!['approved', 'warning', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    await connection.execute(
      'UPDATE businesses SET status = ? WHERE id = ?',
      [status, businessId]
    );

    res.json({ message: 'Business status updated' });
  } catch (err) {
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

    const [rows] = await connection.execute(
      `SELECT check_in, SUM(total_guests) as total_guests
       FROM guest_records
       WHERE business_id = ? AND is_deleted = FALSE AND check_in >= ? AND check_in <= ?
       GROUP BY check_in
       ORDER BY check_in ASC`,
      [businessId, startStr, endStr]
    );

    const result = rows.map(r => ({
      check_in: r.check_in,
      total_guests: Number(r.total_guests)
    }));

    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
