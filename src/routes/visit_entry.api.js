import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { parseOriginGroups } from '../utils/originGroups.js';

const router = express.Router();

/**
 * POST /api/attraction/visit-entry/visit-entries
 * Attraction only: Records a new tourist visit entry.
 * country defaults to 'Philippines' for domestic visitors; nationality is
 * derived from country (country = Philippines => Filipino), never stored.
 */
router.post('/visit-entries', auth.authenticate, auth.requireRole('attraction'), async (req, res, next) => {
  const connection = await db.pool.getConnection();
  await connection.beginTransaction();
  try {
    const {
      visitDate,
      guestCount,
      isForeign,
      country,
      province,
      cityMunicipality,
      maleCount,
      femaleCount,
      originGroups,
    } = req.body;

    if (!visitDate) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const hasGroups = Array.isArray(originGroups) && originGroups.length > 0;

    let parsedGroups = [];
    let guestCountInt;
    let maleCountInt;
    let femaleCountInt;
    let resolvedCountry;
    let resolvedProvince;
    let resolvedCityMunicipality;

    if (hasGroups) {
      // Origin groups are the source of truth for the counts; the row-level
      // origin is written from the FIRST group so the existing origin filter
      // and single-detail view keep working (the breakdowns are the real
      // source, the row origin is a backward-compatible aggregate).
      const parsed = parseOriginGroups(originGroups);
      if (!parsed.ok) {
        return res.status(400).json({ message: parsed.message });
      }
      parsedGroups = parsed.groups;
      const first = parsedGroups[0];
      maleCountInt = parsedGroups.reduce((sum, g) => sum + g.maleCount, 0);
      femaleCountInt = parsedGroups.reduce((sum, g) => sum + g.femaleCount, 0);
      guestCountInt = maleCountInt + femaleCountInt;
      resolvedCountry = first.country || 'Philippines';
      resolvedProvince = resolvedCountry === 'Philippines' ? first.province : null;
      resolvedCityMunicipality = resolvedCountry === 'Philippines' ? first.cityMunicipality : null;
    } else {
      if (!guestCount || typeof isForeign === 'undefined') {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      guestCountInt = parseInt(guestCount, 10);
      if (isNaN(guestCountInt) || guestCountInt < 1) {
        return res.status(400).json({ message: 'guestCount must be a positive integer' });
      }

      // A foreign entry must always carry a country; for domestic visitors the
      // country column is defaulted to 'Philippines' (nationality is derived
      // from the country value, never stored).
      if (isForeign && !country) {
        return res.status(400).json({ message: 'country is required for foreign tourists' });
      }

      // Male/female counts: optional. If one is missing it is derived from the
      // other; if both are blank, fall back to the PSA 47.1%/52.9% split.
      maleCountInt = parseInt(maleCount, 10) || 0;
      femaleCountInt = parseInt(femaleCount, 10) || 0;
      if (!maleCountInt && !femaleCountInt) {
        maleCountInt = Math.round(guestCountInt * 0.471);
        femaleCountInt = guestCountInt - maleCountInt;
      } else if (!maleCountInt) {
        maleCountInt = guestCountInt - femaleCountInt;
      } else if (!femaleCountInt) {
        femaleCountInt = guestCountInt - maleCountInt;
      }

      resolvedCountry = isForeign ? country : 'Philippines';
      resolvedProvince = !isForeign ? (province || null) : null;
      resolvedCityMunicipality = !isForeign ? (cityMunicipality || null) : null;
    }

    // Resolve the attraction that belongs to this user.
    const [attractions] = await connection.execute(
      'SELECT id FROM tourist_attractions WHERE user_id = ? AND deleted_at IS NULL AND status IN (\'approved\', \'warning\')',
      [req.user.id]
    );

    if (attractions.length === 0) {
      return res.status(403).json({ message: 'No approved attraction associated with this account.' });
    }

    const attractionId = attractions[0].id;
    const visitEntryId = uuidv4();

    await connection.execute(
      `INSERT INTO attraction_visit_logs (
        id, attraction_id, visit_date, guest_count,
        male_count, female_count,
        country, province, city_municipality
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        visitEntryId,
        attractionId,
        visitDate,
        guestCountInt,
        maleCountInt,
        femaleCountInt,
        resolvedCountry,
        resolvedProvince,
        resolvedCityMunicipality,
      ]
    );

    // Insert origin group breakdown rows (derived counts live on the parent).
    if (hasGroups) {
      for (const group of parsedGroups) {
        await connection.execute(
          `INSERT INTO guest_origin_breakdowns (
            id, visit_log_id, country, is_overseas,
            province, city_municipality, male_count, female_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            visitEntryId,
            group.country,
            group.isOverseas ? 1 : 0,
            group.province,
            group.cityMunicipality,
            group.maleCount,
            group.femaleCount,
          ]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ message: 'Visit entry saved successfully', visitEntryId });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

export default router;
