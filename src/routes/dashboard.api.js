import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

async function getRegistrationCounts() {
  const [rows] = await db.pool.execute(
    `SELECT 'b' AS kind, status, COUNT(*) AS count FROM businesses
       WHERE deleted_at IS NULL AND status IN ('approved','pending') GROUP BY status
     UNION ALL
     SELECT 't', status, COUNT(*) FROM tourist_attractions
       WHERE deleted_at IS NULL AND status IN ('approved','pending') GROUP BY status`);
  const n = (k, s) => Number(rows.find(r => r.kind === k && r.status === s)?.count ?? 0);
  return {
    activeAccommodations: n('b','approved'), pendingAccommodations: n('b','pending'),
    activeAttractions: n('t','approved'),   pendingAttractions: n('t','pending'),
  };
}

/**
 * GET /api/dashboard/stats
 * Admin only: returns counts of active and pending businesses/attractions
 */
router.get('/stats', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await getRegistrationCounts());
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/dashboard/pending-counts
 * Admin only: lightweight counts of pending registrations used for
 * navigation badges in the admin sidebar / bottom nav.
 */
router.get('/pending-counts', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  try {
    const counts = await getRegistrationCounts();
    res.json({
      pendingAccommodations: counts.pendingAccommodations,
      pendingAttractions: counts.pendingAttractions,
    });
  } catch (err) {
    next(err);
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
                   AND ((actual_check_out IS NOT NULL AND actual_check_out >= ?) OR (actual_check_out IS NULL AND check_out >= ?)) AND check_in <= ?`;
    let params = [startDate, startDate, endDate];

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
      `SELECT gr.id AS guest_record_id, gr.lead_country AS country,
              COALESCE(NULLIF(TRIM(gr.lead_province), ''),
                (SELECT g.province FROM guest_origin_breakdowns g
                  WHERE g.guest_record_id = gr.id AND g.deleted_at IS NULL
                    AND g.province IS NOT NULL AND TRIM(g.province) <> ''
                  LIMIT 1)) AS province,
              COALESCE(NULLIF(TRIM(gr.lead_city_municipality), ''),
                (SELECT g.city_municipality FROM guest_origin_breakdowns g
                  WHERE g.guest_record_id = gr.id AND g.deleted_at IS NULL
                    AND g.city_municipality IS NOT NULL AND TRIM(g.city_municipality) <> ''
                  LIMIT 1)) AS city_municipality,
              gr.lead_sex AS sex,
              gr.lead_is_overseas AS is_overseas,
              CASE
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 9  THEN '0-9'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 17 THEN '10-17'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 25 THEN '18-25'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 35 THEN '26-35'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 45 THEN '36-45'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 55 THEN '46-55'
                ELSE '56+'
              END AS age_group,
              1 AS count
       FROM guest_records gr
       WHERE gr.id IN (${placeholders}) AND gr.is_deleted = FALSE`,
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
 * GET /api/dashboard/trend
 * Admin only: monthly accommodation + attraction trend for the requested years
 */
router.get('/trend', auth.authenticate, auth.requireRole('admin'), async (req, res, next) => {
  try {
    const yearsParam = req.query.years;
    if (typeof yearsParam !== 'string' || yearsParam.trim() === '') {
      return res.status(400).json({ message: 'Missing years parameter' });
    }

    const parts = yearsParam.split(',');
    if (parts.length > 5) {
      return res.status(400).json({ message: 'At most 5 years are allowed' });
    }

    const years = [];
    for (const part of parts) {
      const num = Number(part.trim());
      if (!Number.isInteger(num) || num < 2000 || num > 2100) {
        return res.status(400).json({ message: 'Invalid year' });
      }
      years.push(num);
    }

    const attractionSql = `SELECT MONTH(avl.visit_date) AS m, SUM(avl.guest_count) AS c
       FROM attraction_visit_logs avl
       JOIN tourist_attractions ta ON ta.id = avl.attraction_id
       WHERE avl.deleted_at IS NULL
         AND ta.deleted_at IS NULL
         AND ta.status = 'approved'
         AND avl.visit_date >= ? AND avl.visit_date <= ?
         AND avl.guest_count > 0
       GROUP BY MONTH(avl.visit_date)`;
    const accommodationSql = `SELECT check_in, check_out, actual_check_out, total_guests
       FROM guest_records
       WHERE is_deleted = FALSE
         AND ((actual_check_out IS NOT NULL AND actual_check_out >= ?)
              OR (actual_check_out IS NULL AND check_out >= ?))
         AND check_in <= ?`;

    const tasks = years.map(async (year) => {
      const jan1 = `${year}-01-01`;
      const dec31 = `${year}-12-31`;

      const [attractionRows] = await db.pool.execute(attractionSql, [jan1, dec31]);
      const attractionMonthly = new Array(12).fill(0);
      for (const row of attractionRows) {
        const monthIndex = Number(row.m) - 1;
        if (monthIndex >= 0 && monthIndex < 12) {
          attractionMonthly[monthIndex] += Number(row.c);
        }
      }

      const [accommodationRows] = await db.pool.execute(accommodationSql, [jan1, jan1, dec31]);
      const accommodationMonthly = new Array(12).fill(0);
      for (const row of accommodationRows) {
        const totalGuests = Number(row.total_guests);
        if (!Number.isFinite(totalGuests) || totalGuests <= 0) continue;

        const checkInText = String(row.check_in).substring(0, 10);
        const rawCheckout = row.actual_check_out ?? row.check_out;
        const checkoutText = String(rawCheckout).substring(0, 10);
        const checkIn = new Date(`${checkInText}T00:00:00Z`);
        const checkOut = new Date(`${checkoutText}T00:00:00Z`);
        if (checkOut.getTime() < checkIn.getTime()) continue;

        const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);
        const spreadDays = nights + 1;
        const stayEnd = new Date(checkIn.getTime() + spreadDays * 86400000);
        const rangeStart = new Date(Date.UTC(year, 0, 1));
        const rangeEnd = new Date(Date.UTC(year + 1, 0, 1));

        let segmentStart = Math.max(checkIn.getTime(), rangeStart.getTime());
        const segmentEnd = Math.min(stayEnd.getTime(), rangeEnd.getTime());
        if (segmentEnd <= segmentStart) continue;

        while (segmentStart < segmentEnd) {
          const cursorDate = new Date(segmentStart);
          const monthEnd = Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 1);
          const chunkEnd = Math.min(monthEnd, segmentEnd);
          const days = Math.round((chunkEnd - segmentStart) / 86400000);
          accommodationMonthly[cursorDate.getUTCMonth()] += totalGuests * days;
          segmentStart = chunkEnd;
        }
      }

      const combined = accommodationMonthly.map((value, index) => Number(value) + Number(attractionMonthly[index]));
      return { year, monthly: combined };
    });

    const results = await Promise.all(tasks);
    const response = {};
    for (const result of results) {
      response[String(result.year)] = result.monthly;
    }
    res.json(response);
  } catch (err) {
    next(err);
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

  try {
    const sameRange = startDate === yearStart && endDate === yearEnd;

    const [registrationCounts, periodResult, yearResult, visitResult, yearVisitResult] = await Promise.all([
      getRegistrationCounts(),
      db.pool.execute(
        `SELECT id, business_id, check_in, check_out, actual_check_out, total_guests,
                male_count, female_count, lead_sex, purpose_of_visit
         FROM guest_records WHERE is_deleted = FALSE AND ((actual_check_out IS NOT NULL AND actual_check_out >= ?) OR (actual_check_out IS NULL AND check_out >= ?)) AND check_in <= ?`,
        [startDate, startDate, endDate]
      ),
      sameRange
        ? null
        : db.pool.execute(
            `SELECT id, business_id, check_in, check_out, actual_check_out, total_guests,
                    male_count, female_count, lead_sex, purpose_of_visit
             FROM guest_records WHERE is_deleted = FALSE AND ((actual_check_out IS NOT NULL AND actual_check_out >= ?) OR (actual_check_out IS NULL AND check_out >= ?)) AND check_in <= ?`,
            [yearStart, yearStart, yearEnd]
          ),
      db.pool.execute(
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
      ),
      sameRange
        ? null
        : db.pool.execute(
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
          ),
    ]);

    const periodRecords = periodResult[0];
    const yearRecords = sameRange ? periodRecords : yearResult[0];

    const attractionVisitLogs = visitResult[0].map((r) => ({
      ...r,
      attraction_type: typeof r.attraction_type === 'string' ? JSON.parse(r.attraction_type) : r.attraction_type,
    }));
    const yearAttractionVisitLogs = sameRange
      ? attractionVisitLogs
      : yearVisitResult[0].map((r) => ({
          ...r,
          attraction_type: typeof r.attraction_type === 'string' ? JSON.parse(r.attraction_type) : r.attraction_type,
        }));

    const recordIds = periodRecords.map((r) => r.id);
    const businessIds = [...new Set(periodRecords.map((r) => r.business_id))];

    const breakdownPlaceholders = recordIds.map(() => '?').join(',');
    const businessPlaceholders = businessIds.map(() => '?').join(',');

    const [breakdownsResult, businessLinesResult] = await Promise.all([
      recordIds.length > 0
        ? db.pool.execute(
            `SELECT id AS guest_record_id, lead_country AS country,
                    lead_province AS province,
                    lead_city_municipality AS city_municipality,
                    lead_sex AS sex,
                    lead_is_overseas AS is_overseas,
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
             WHERE id IN (` + breakdownPlaceholders + `) AND is_deleted = FALSE`,
            recordIds
          )
        : Promise.resolve([[]]),
      businessIds.length > 0
        ? db.pool.execute(
            `SELECT id, business_line FROM businesses
             WHERE id IN (` + businessPlaceholders + `) AND status = 'approved' AND deleted_at IS NULL`,
            businessIds
          )
        : Promise.resolve([[]]),
    ]);

    const breakdowns = recordIds.length > 0 ? breakdownsResult[0] : [];
    const businessLines = businessIds.length > 0 ? businessLinesResult[0] : [];

    res.json({
      stats: registrationCounts,
      periodRecords,
      yearRecords,
      breakdowns,
      businessLines,
      attractionVisitLogs,
      yearAttractionVisitLogs,
    });
  } catch (err) {
    next(err);
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
                   AND ((actual_check_out IS NOT NULL AND actual_check_out >= ?) OR (actual_check_out IS NULL AND check_out >= ?)) AND check_in <= ?`;
    let params = [startDate, startDate, endDate];

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
      `SELECT gr.id AS guest_record_id, gr.lead_country AS country,
              COALESCE(NULLIF(TRIM(gr.lead_province), ''),
                (SELECT g.province FROM guest_origin_breakdowns g
                  WHERE g.guest_record_id = gr.id AND g.deleted_at IS NULL
                    AND g.province IS NOT NULL AND TRIM(g.province) <> ''
                  LIMIT 1)) AS province,
              COALESCE(NULLIF(TRIM(gr.lead_city_municipality), ''),
                (SELECT g.city_municipality FROM guest_origin_breakdowns g
                  WHERE g.guest_record_id = gr.id AND g.deleted_at IS NULL
                    AND g.city_municipality IS NOT NULL AND TRIM(g.city_municipality) <> ''
                  LIMIT 1)) AS city_municipality,
              gr.lead_sex AS sex,
              gr.lead_is_overseas AS is_overseas,
              CASE
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 9  THEN '0-9'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 17 THEN '10-17'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 25 THEN '18-25'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 35 THEN '26-35'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 45 THEN '36-45'
                WHEN TIMESTAMPDIFF(YEAR, gr.lead_birthdate, gr.check_in) <= 55 THEN '46-55'
                ELSE '56+'
              END AS age_group,
              1 AS count
       FROM guest_records gr
       WHERE gr.id IN (${placeholders}) AND gr.is_deleted = FALSE`,
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

export default router;
