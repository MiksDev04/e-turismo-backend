import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/attraction-dashboard/details
 * Attraction only: Returns profile data for the current user's attraction
 */
router.get('/details', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT id, attraction_name, attraction_type, street, barangay
       FROM tourist_attractions
       WHERE user_id = ? AND deleted_at IS NULL AND status = 'approved'`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'No attraction associated with this account.' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/attraction-dashboard/visit-logs
 * Attraction only: Returns visit logs for the current user's attraction
 * within the given date range (inclusive).
 */
router.get('/visit-logs', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Missing date parameters' });
    }

    const [attractions] = await connection.execute(
      'SELECT id FROM tourist_attractions WHERE user_id = ? AND deleted_at IS NULL',
      [req.user.id]
    );
    if (attractions.length === 0) {
      return res.status(403).json({ message: 'No attraction associated with this account' });
    }

    const [rows] = await connection.execute(
      `SELECT id, attraction_id, visit_date, guest_count,
              male_count, female_count,
              country, province, city_municipality
       FROM attraction_visit_logs
       WHERE attraction_id = ? AND deleted_at IS NULL
         AND visit_date >= ? AND visit_date <= ?
       ORDER BY visit_date ASC`,
      [attractions[0].id, startDate, endDate]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
