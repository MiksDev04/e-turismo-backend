import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

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
    } = req.body;

    if (!visitDate || !guestCount || typeof isForeign === 'undefined') {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    let guestCountInt = parseInt(guestCount, 10);
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
    let maleCountInt = parseInt(maleCount, 10) || 0;
    let femaleCountInt = parseInt(femaleCount, 10) || 0;
    if (!maleCountInt && !femaleCountInt) {
      maleCountInt = Math.round(guestCountInt * 0.471);
      femaleCountInt = guestCountInt - maleCountInt;
    } else if (!maleCountInt) {
      maleCountInt = guestCountInt - femaleCountInt;
    } else if (!femaleCountInt) {
      femaleCountInt = guestCountInt - maleCountInt;
    }

    const resolvedCountry = isForeign ? country : 'Philippines';
    const resolvedProvince = !isForeign ? (province || null) : null;
    const resolvedCityMunicipality = !isForeign ? (cityMunicipality || null) : null;

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
