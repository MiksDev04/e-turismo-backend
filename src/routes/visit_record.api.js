import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/attraction/visit-records
 * Fetch paginated attraction visit logs for the current user's attraction,
 * with optional date-range and origin classification filters.
 *
 * Query params:
 *   page            – 1-based page number        (default 1)
 *   pageSize        – rows per page              (default 10, max 100)
 *   dateFrom        – ISO date 'YYYY-MM-DD'      (inclusive)
 *   dateTo          – ISO date 'YYYY-MM-DD'      (inclusive)
 *   origin          – 'all' | 'domestic' | 'international'
 *                     domestic   = country = 'Philippines' (Filipino visitors)
 *                     international = country IS NOT NULL AND country <> 'Philippines'
 *                                     OR is_foreign = 1 (Foreign visitors; the
 *                                     country may be unknown)
 *   includeDeleted  – 'true' to include soft-deleted records
 *   lastSync        – ISO timestamp; delta sync returns ONLY rows whose
 *                     updated_at is newer (INCLUDING soft-deleted rows so the
 *                     client can prune). Date/origin filters are ignored.
 *   fetchAll        – 'true' to skip paging and return a bare array of all
 *                     matching rows (used with delta sync).
 *   attractionId    – scope the pull to one owned attraction. Validated against
 *                     the authenticated user; unknown ids → 404. Falls back to
 *                     the account's first attraction when omitted.
 */
router.get('/visit-records', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const {
      page = '1',
      pageSize = '10',
      dateFrom,
      dateTo,
      origin = 'all',
      includeDeleted,
      lastSync,
      fetchAll,
      attractionId,
    } = req.query;

    const isDeltaSync = !!lastSync;

    // ── Resolve attraction_id from the authenticated user ───────────────────
    const [attractions] = await connection.execute(
      `SELECT id FROM tourist_attractions
       WHERE user_id = ? AND deleted_at IS NULL`,
      [req.user.id],
    );

    if (attractions.length === 0) {
      return res.status(404).json({ message: 'No attraction associated with this account.' });
    }

    // ── Per-attraction scoping ─────────────────────────────────────────────
    // When the client asks for a specific attraction, validate it belongs to
    // this user so a foreign/unknown id can never leak another account's rows.
    // Without the param, keep the legacy behavior (first attraction).
    let attractionIdFinal = attractions[0].id;
    if (attractionId) {
      const [match] = await connection.execute(
        `SELECT id FROM tourist_attractions
         WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
        [req.user.id, attractionId],
      );
      if (match.length === 0) {
        return res.status(404).json({ message: 'Attraction not found.' });
      }
      attractionIdFinal = match[0].id;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    // ── Build WHERE clause ────────────────────────────────────────────────
    // Delta sync (lastSync): return ALL rows modified after lastSync — every
    // status and INCLUDING soft-deleted rows so the client can detect and
    // prune them. Date/origin filters are skipped, mirroring the business
    // guest-records delta contract.
    const conditions = ['avl.attraction_id = ?'];
    const params = [attractionIdFinal];

    if (isDeltaSync) {
      conditions.push('avl.updated_at > ?');
      params.push(lastSync);
    } else {
      if (includeDeleted !== 'true') {
        conditions.push('avl.deleted_at IS NULL');
      }

      if (dateFrom) {
        conditions.push('avl.visit_date >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        conditions.push('avl.visit_date <= ?');
        params.push(dateTo);
      }
      if (origin === 'international') {
        conditions.push("(avl.country IS NOT NULL AND avl.country <> 'Philippines') OR avl.is_foreign = 1");
      } else if (origin === 'domestic') {
        conditions.push("avl.country = 'Philippines'");
      }
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total matching rows (skipped when fetchAll) ─────────────────
    let totalCount = 0;
    if (fetchAll !== 'true') {
      const [countRows] = await connection.query(
        `SELECT COUNT(*) as total
         FROM attraction_visit_logs avl
         WHERE ${whereClause}`,
        params,
      );
      totalCount = countRows[0].total;

      if (totalCount === 0) {
        return res.json({ data: [], totalCount: 0, pageCount: 0 });
      }
    }

    // ── Fetch visit logs with derived nationality ─────────────────────────
    const columns = `avl.id, avl.attraction_id, avl.visit_date,
            avl.guest_count, avl.male_count, avl.female_count,
            avl.is_foreign,
            avl.country, avl.province, avl.city_municipality,
            avl.created_at, avl.updated_at, avl.deleted_at,
CASE
               WHEN avl.country = 'Philippines' THEN 'Filipino'
               WHEN avl.country IS NOT NULL AND avl.country <> 'Philippines' THEN 'Foreign'
               WHEN avl.is_foreign = 1 THEN 'Foreign'
               ELSE 'Unknown'
             END AS nationality`;
    const orderBy = isDeltaSync
      ? 'avl.updated_at ASC'
      : 'avl.created_at DESC, avl.id DESC';
    let query =
      `SELECT ${columns}
       FROM attraction_visit_logs avl
       WHERE ${whereClause}
       ORDER BY ${orderBy}`;
    const queryParams = [...params];
    if (fetchAll !== 'true') {
      query += ' LIMIT ? OFFSET ?';
      queryParams.push(limit, offset);
    }
    const [rows] = await connection.query(query, queryParams);

    const data = rows.map((r) => ({
      ...r,
      nationality: r.nationality,
      guest_count: r.guest_count,
      male_count: r.male_count,
      female_count: r.female_count,
      isDeleted: r.deleted_at !== null && r.deleted_at !== undefined,
    }));

    if (fetchAll === 'true') {
      return res.json(data);
    }
    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/attraction/visit-records/:id
 * Fetch a single visit log by ID (only if it belongs to the current user's
 * attraction).
 */
router.get('/visit-records/:id', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  try {
    const [attractions] = await connection.execute(
      `SELECT id FROM tourist_attractions
       WHERE user_id = ? AND deleted_at IS NULL`,
      [req.user.id],
    );

    if (attractions.length === 0) {
      return res.status(404).json({ message: 'No attraction associated with this account.' });
    }

    const attractionId = attractions[0].id;

    const [rows] = await connection.execute(
      `SELECT avl.id, avl.attraction_id, avl.visit_date,
              avl.guest_count, avl.male_count, avl.female_count,
              avl.is_foreign,
              avl.country, avl.province, avl.city_municipality,
              avl.created_at, avl.updated_at, avl.deleted_at,
              CASE
                WHEN avl.country = 'Philippines' THEN 'Filipino'
                WHEN avl.country IS NOT NULL AND avl.country <> 'Philippines' THEN 'Foreign'
                WHEN avl.is_foreign = 1 THEN 'Foreign'
                ELSE 'Unknown'
              END AS nationality
       FROM attraction_visit_logs avl
       WHERE avl.id = ? AND avl.attraction_id = ?`,
      [req.params.id, attractionId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Visit log not found.' });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
