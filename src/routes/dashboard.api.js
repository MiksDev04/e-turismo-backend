import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Admin only: returns counts of active and pending businesses
 */
router.get('/stats', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [active] = await connection.execute(
      'SELECT COUNT(*) as count FROM businesses WHERE status = "approved" AND deleted_at IS NULL'
    );
    const [pending] = await connection.execute(
      'SELECT COUNT(*) as count FROM businesses WHERE status = "pending" AND deleted_at IS NULL'
    );
    res.json({
      activeAccommodations: active[0].count,
      pendingRegistrations: pending[0].count
    });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/dashboard/details
 * Business only: Returns profile + business data for current user
 */
router.get('/details', auth.authenticate, auth.requireRole('business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { businessId } = req.query;
    if (!businessId) {
      return res.status(400).json({ message: 'Missing businessId parameter' });
    }

    const [rows] = await connection.execute(
      `SELECT street, total_rooms, business_line FROM businesses WHERE id = ?`,
      [businessId]
    );

    if (rows.length === 0) {
      return res.json(null);
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/dashboard/guest-records
 * Shared: Admin can see all, business only their own
 */
router.get('/guest-records', auth.authenticate, auth.requireRole('admin', 'business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { businessId, startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Missing date parameters' });
    }

    let query = `SELECT id, business_id, check_in, check_out, total_guests, rooms_occupied, purpose_of_visit
                 FROM guest_records 
                 WHERE is_deleted = FALSE 
                   AND check_in >= ? AND check_in <= ?`;
    let params = [startDate, endDate];

    if (req.user.role === 'business') {
      // Business must specify their ID and it must match their session or they must be authorized
      // For simplicity, we assume if they are business role, they can only see their own business_id
      // We should verify if the businessId matches their account if they provide one,
      // or just use their account's businessId.
      
      // Let's find the business ID for this user if not provided or to enforce it
      const [biz] = await connection.execute('SELECT id FROM businesses WHERE user_id = ?', [req.user.id]);
      if (biz.length === 0) return res.status(403).json({ message: 'No business associated with this account' });
      
      query += ` AND business_id = ?`;
      params.push(biz[0].id);
    } else if (businessId) {
      // Admin can filter by businessId
      query += ` AND business_id = ?`;
      params.push(businessId);
    }

    const [rows] = await connection.execute(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/dashboard/breakdowns
 * Shared
 */
router.get('/breakdowns', auth.authenticate, auth.requireRole('admin', 'business'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { recordIds } = req.query;
    if (!recordIds) {
      return res.json([]);
    }

    const idsArray = recordIds.split(',');
    if (idsArray.length === 0) {
      return res.json([]);
    }

    const placeholders = idsArray.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT guest_record_id, country, philippines_region, sex, age_group, count
       FROM guest_breakdowns
       WHERE guest_record_id IN (${placeholders})`,
      idsArray
    );

    res.json(rows);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/dashboard/business-lines
 * Admin only: Returns business lines for a list of business IDs
 */
router.get('/business-lines', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const { businessIds } = req.query;
    if (!businessIds) return res.json([]);

    const idsArray = businessIds.split(',');
    if (idsArray.length === 0) return res.json([]);

    const placeholders = idsArray.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT id, business_line FROM businesses 
       WHERE id IN (${placeholders}) AND status = "approved" AND deleted_at IS NULL`,
      idsArray
    );

    res.json(rows);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
