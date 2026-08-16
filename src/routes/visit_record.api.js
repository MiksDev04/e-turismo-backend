import express from 'express';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { breakdownToJson } from '../utils/originGroups.js';

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
 *                                     (Foreign visitors)
 *   includeDeleted  – 'true' to include soft-deleted records
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
    } = req.query;

    // ── Resolve attraction_id from the authenticated user ───────────────────
    const [attractions] = await connection.execute(
      `SELECT id FROM tourist_attractions
       WHERE user_id = ? AND deleted_at IS NULL`,
      [req.user.id],
    );

    if (attractions.length === 0) {
      return res.status(404).json({ message: 'No attraction associated with this account.' });
    }

    const attractionId = attractions[0].id;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    // ── Build WHERE clause ────────────────────────────────────────────────
    const conditions = ['avl.attraction_id = ?'];
    const params = [attractionId];

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
      conditions.push("avl.country IS NOT NULL AND avl.country <> 'Philippines'");
    } else if (origin === 'domestic') {
      conditions.push("avl.country = 'Philippines'");
    }

    const whereClause = conditions.join(' AND ');

    // ── Count total matching rows ─────────────────────────────────────────
    const [countRows] = await connection.query(
      `SELECT COUNT(*) as total
       FROM attraction_visit_logs avl
       WHERE ${whereClause}`,
      params,
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    const pageCount = Math.ceil(totalCount / limit);

    // ── Fetch visit logs with derived nationality ─────────────────────────
    const [rows] = await connection.query(
      `SELECT avl.id, avl.attraction_id, avl.visit_date,
              avl.guest_count, avl.male_count, avl.female_count,
              avl.country, avl.province, avl.city_municipality,
              avl.created_at, avl.updated_at, avl.deleted_at,
              CASE
                WHEN avl.country = 'Philippines' THEN 'Filipino'
                ELSE 'Foreign'
              END AS nationality
       FROM attraction_visit_logs avl
       WHERE ${whereClause}
       ORDER BY avl.visit_date DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    // ── Fetch origin groups for these logs via guest_origin_breakdowns ────
    const logIds = rows.map((r) => r.id);
    let breakdownsByLog = {};

    if (logIds.length > 0) {
      const placeholders = logIds.map(() => '?').join(',');
      const [breakdowns] = await connection.execute(
        `SELECT visit_log_id, id, country, is_overseas, province,
                city_municipality, male_count, female_count
         FROM guest_origin_breakdowns
         WHERE visit_log_id IN (${placeholders}) AND deleted_at IS NULL`,
        logIds
      );

      for (const b of breakdowns) {
        if (!breakdownsByLog[b.visit_log_id]) {
          breakdownsByLog[b.visit_log_id] = [];
        }
        breakdownsByLog[b.visit_log_id].push(breakdownToJson(b));
      }
    }

    const data = rows.map((r) => ({
      ...r,
      nationality: r.nationality,
      guest_count: r.guest_count,
      male_count: r.male_count,
      female_count: r.female_count,
      isDeleted: r.deleted_at !== null && r.deleted_at !== undefined,
      guest_breakdowns: breakdownsByLog[r.id] || [],
    }));

    res.json({ data, totalCount, pageCount });
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
              avl.country, avl.province, avl.city_municipality,
              avl.created_at, avl.updated_at, avl.deleted_at,
              CASE
                WHEN avl.country = 'Philippines' THEN 'Filipino'
                ELSE 'Foreign'
              END AS nationality
       FROM attraction_visit_logs avl
       WHERE avl.id = ? AND avl.attraction_id = ?`,
      [req.params.id, attractionId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Visit log not found.' });
    }

    const [breakdowns] = await connection.execute(
      `SELECT id, country, is_overseas, province,
              city_municipality, male_count, female_count
       FROM guest_origin_breakdowns
       WHERE visit_log_id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );

    res.json({ ...rows[0], guest_breakdowns: breakdowns.map(breakdownToJson) });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
