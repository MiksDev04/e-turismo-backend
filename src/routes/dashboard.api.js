import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Admin only: returns counts of active and pending businesses/attractions
 */
router.get('/stats', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [active] = await connection.execute(
      `SELECT COUNT(*) as count FROM businesses WHERE status = 'approved' AND deleted_at IS NULL`
    );
    const [pending] = await connection.execute(
      `SELECT COUNT(*) as count FROM businesses WHERE status = 'pending' AND deleted_at IS NULL`
    );
    const [activeAttractions] = await connection.execute(
      `SELECT COUNT(*) as count FROM tourist_attractions WHERE status = 'approved' AND deleted_at IS NULL`
    );
    const [pendingAttractions] = await connection.execute(
      `SELECT COUNT(*) as count FROM tourist_attractions WHERE status = 'pending' AND deleted_at IS NULL`
    );
    res.json({
      activeAccommodations: active[0].count,
      pendingAccommodations: pending[0].count,
      activeAttractions: activeAttractions[0].count,
      pendingAttractions: pendingAttractions[0].count
    });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/dashboard/pending-counts
 * Admin only: lightweight counts of pending registrations used for
 * navigation badges in the admin sidebar / bottom nav.
 */
router.get('/pending-counts', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [pending] = await connection.execute(
      `SELECT COUNT(*) as count FROM businesses WHERE status = 'pending' AND deleted_at IS NULL`
    );
    const [pendingAttractions] = await connection.execute(
      `SELECT COUNT(*) as count FROM tourist_attractions WHERE status = 'pending' AND deleted_at IS NULL`
    );
    res.json({
      pendingAccommodations: pending[0].count,
      pendingAttractions: pendingAttractions[0].count
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
      `SELECT street, barangay, (SELECT COUNT(*) FROM rooms WHERE business_id = businesses.id) AS total_rooms, business_line FROM businesses WHERE id = ?`,
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

    let query = `SELECT id, business_id, check_in, check_out, actual_check_out, total_guests,
                        male_count, female_count, lead_sex, purpose_of_visit
                 FROM guest_records 
                 WHERE is_deleted = FALSE 
                   AND COALESCE(actual_check_out, check_out) >= ? AND check_in <= ?`;
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
      `SELECT id AS guest_record_id, lead_country AS country,
              lead_province AS province,
              lead_city_municipality AS city_municipality,
              lead_sex AS sex,
              CASE
                WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 9  THEN '0-9'
                WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 17 THEN '10-17'
                WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 25 THEN '18-25'
                WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 35 THEN '26-35'
                WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 45 THEN '36-45'
                WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 55 THEN '46-55'
                ELSE '56+'
              END AS age_group,
              1 AS count
       FROM guest_records
       WHERE id IN (${placeholders}) AND is_deleted = FALSE`,
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
       WHERE id IN (${placeholders}) AND status = 'approved' AND deleted_at IS NULL`,
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
 * GET /api/dashboard/attraction-visit-logs
 * Admin only: Returns approved tourist-attraction visit logs within a date
 * range (inclusive). Used by the admin dashboard trend + donut charts.
 */
router.get('/attraction-visit-logs', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ message: 'Missing date parameters' });
  }

  const connection = await db.pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT avl.id, avl.attraction_id, ta.attraction_type, avl.visit_date,
              avl.guest_count, avl.male_count, avl.female_count,
              avl.country, avl.province, avl.city_municipality
       FROM attraction_visit_logs avl
       JOIN tourist_attractions ta ON ta.id = avl.attraction_id
       WHERE avl.deleted_at IS NULL
         AND ta.deleted_at IS NULL
         AND ta.status = 'approved'
         AND avl.visit_date >= ? AND avl.visit_date <= ?
       ORDER BY avl.visit_date ASC`,
      [startDate, endDate]
    );

    res.json(
      rows.map((r) => ({
        ...r,
        attraction_type: typeof r.attraction_type === 'string' ? JSON.parse(r.attraction_type) : r.attraction_type,
      }))
    );
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/dashboard/attraction/details
 * Attraction only: Returns profile data for the current user's attraction
 */
router.get('/attraction/details', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
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
 * GET /api/dashboard/attraction/visit-logs
 * Attraction only: Returns visit logs for the current user's attraction
 * within the given date range (inclusive).
 */
router.get('/attraction/visit-logs', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
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

/**
 * GET /api/dashboard/summary
 * Admin only: consolidated endpoint returning all dashboard data in one call
 * Replaces 4–6 individual API calls with a single request.
 */
router.get('/summary', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  const { startDate, endDate, yearStart, yearEnd } = req.query;
  if (!startDate || !endDate || !yearStart || !yearEnd) {
    return res.status(400).json({ message: 'Missing date parameters' });
  }

  const connection = await db.pool.getConnection();
  try {
    const [active] = await connection.execute(
      `SELECT COUNT(*) as count FROM businesses WHERE status = 'approved' AND deleted_at IS NULL`
    );
    const [pending] = await connection.execute(
      `SELECT COUNT(*) as count FROM businesses WHERE status = 'pending' AND deleted_at IS NULL`
    );
    const [activeAttractions] = await connection.execute(
      `SELECT COUNT(*) as count FROM tourist_attractions WHERE status = 'approved' AND deleted_at IS NULL`
    );
    const [pendingAttractions] = await connection.execute(
      `SELECT COUNT(*) as count FROM tourist_attractions WHERE status = 'pending' AND deleted_at IS NULL`
    );

    const [periodRecords] = await connection.execute(
      `SELECT id, business_id, check_in, check_out, actual_check_out, total_guests,
              male_count, female_count, lead_sex, purpose_of_visit
       FROM guest_records WHERE is_deleted = FALSE AND COALESCE(actual_check_out, check_out) >= ? AND check_in <= ?`,
      [startDate, endDate]
    );

    let yearRecords;
    if (startDate === yearStart && endDate === yearEnd) {
      yearRecords = periodRecords;
    } else {
      const [rows] = await connection.execute(
        `SELECT id, business_id, check_in, check_out, actual_check_out, total_guests,
                male_count, female_count, lead_sex, purpose_of_visit
         FROM guest_records WHERE is_deleted = FALSE AND COALESCE(actual_check_out, check_out) >= ? AND check_in <= ?`,
        [yearStart, yearEnd]
      );
      yearRecords = rows;
    }

    const recordIds = periodRecords.map((r) => r.id);
    let breakdowns = [];
    if (recordIds.length > 0) {
      const placeholders = recordIds.map(() => '?').join(',');
      const [rows] = await connection.execute(
        `SELECT id AS guest_record_id, lead_country AS country,
                lead_province AS province,
                lead_city_municipality AS city_municipality,
                lead_sex AS sex,
                CASE
                  WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 9  THEN '0-9'
                  WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 17 THEN '10-17'
                  WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 25 THEN '18-25'
                  WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 35 THEN '26-35'
                  WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 45 THEN '36-45'
                  WHEN TIMESTAMPDIFF(YEAR, lead_birthdate, check_in) <= 55 THEN '46-55'
                  ELSE '56+'
                END AS age_group,
                1 AS count
         FROM guest_records
         WHERE id IN (${placeholders}) AND is_deleted = FALSE`,
        recordIds
      );
      breakdowns = rows;
    }

    const businessIds = [...new Set(periodRecords.map((r) => r.business_id))];
    let businessLines = [];
    if (businessIds.length > 0) {
      const placeholders = businessIds.map(() => '?').join(',');
      const [rows] = await connection.execute(
        `SELECT id, business_line FROM businesses
         WHERE id IN (${placeholders}) AND status = 'approved' AND deleted_at IS NULL`,
        businessIds
      );
      businessLines = rows;
    }

    let attractionVisitLogs = [];
    {
      const [rows] = await connection.execute(
        `SELECT avl.id, avl.attraction_id, ta.attraction_type, avl.visit_date,
                avl.guest_count, avl.male_count, avl.female_count,
                avl.country, avl.province, avl.city_municipality
         FROM attraction_visit_logs avl
         JOIN tourist_attractions ta ON ta.id = avl.attraction_id
         WHERE avl.deleted_at IS NULL
           AND ta.deleted_at IS NULL
           AND ta.status = 'approved'
           AND avl.visit_date >= ? AND avl.visit_date <= ?`,
        [startDate, endDate]
      );
      attractionVisitLogs = rows.map((r) => ({
        ...r,
        attraction_type: typeof r.attraction_type === 'string' ? JSON.parse(r.attraction_type) : r.attraction_type,
      }));
    }

    let yearAttractionVisitLogs;
    if (startDate === yearStart && endDate === yearEnd) {
      yearAttractionVisitLogs = attractionVisitLogs;
    } else {
      const [rows] = await connection.execute(
        `SELECT avl.id, avl.attraction_id, ta.attraction_type, avl.visit_date,
                avl.guest_count, avl.male_count, avl.female_count,
                avl.country, avl.province, avl.city_municipality
         FROM attraction_visit_logs avl
         JOIN tourist_attractions ta ON ta.id = avl.attraction_id
         WHERE avl.deleted_at IS NULL
           AND ta.deleted_at IS NULL
           AND ta.status = 'approved'
           AND avl.visit_date >= ? AND avl.visit_date <= ?`,
        [yearStart, yearEnd]
      );
      yearAttractionVisitLogs = rows.map((r) => ({
        ...r,
        attraction_type: typeof r.attraction_type === 'string' ? JSON.parse(r.attraction_type) : r.attraction_type,
      }));
    }

    res.json({
      stats: {
        activeAccommodations: active[0].count,
        pendingAccommodations: pending[0].count,
        activeAttractions: activeAttractions[0].count,
        pendingAttractions: pendingAttractions[0].count,
      },
      periodRecords,
      yearRecords,
      breakdowns,
      businessLines,
      attractionVisitLogs,
      yearAttractionVisitLogs,
    });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
