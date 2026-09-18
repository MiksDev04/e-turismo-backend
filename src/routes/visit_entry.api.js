import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/attraction/visit-entry/visit-entries
 * Attraction only: Records a new tourist visit entry.
 * Origin is optional: 'Philippines' is only stored when a domestic origin is
 * actually captured (province/city present); a blank origin stores NULL so the
 * report distributes the visitor over the residence categories. Nationality is
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
      createdAt,
    } = req.body;

    if (!visitDate || !guestCount || typeof isForeign === 'undefined') {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    let guestCountInt = parseInt(guestCount, 10);
    if (isNaN(guestCountInt) || guestCountInt < 1) {
      return res.status(400).json({ message: 'guestCount must be a positive integer' });
    }

    // Origin is now optional for BOTH foreign and domestic entries: an
    // attraction that only does a headcount can leave country/province/city
    // blank, storing NULL and letting the report distribute the visitors over
    // the residence categories at generation time.

    // Male/female counts: optional (nullable in the schema). If exactly one is
    // missing it is completed from the other (male + female = guest_count),
    // because we already have all the information for it. When BOTH are blank
    // the row stores NULL/NULL and gender is estimated at report-generation
    // time (PSA 47.1%/52.9%) — no save-time guessing.
    const hasMale = maleCount != null && String(maleCount).trim() !== '';
    const hasFemale = femaleCount != null && String(femaleCount).trim() !== '';
    let maleCountInt = hasMale ? parseInt(maleCount, 10) : null;
    let femaleCountInt = hasFemale ? parseInt(femaleCount, 10) : null;
    if (maleCountInt != null && (isNaN(maleCountInt) || maleCountInt < 0)) maleCountInt = null;
    if (femaleCountInt != null && (isNaN(femaleCountInt) || femaleCountInt < 0)) femaleCountInt = null;
    if (maleCountInt == null && femaleCountInt == null) {
      // Keep both NULL — origin/gender estimation happens in the report.
    } else if (maleCountInt == null) {
      maleCountInt = guestCountInt - femaleCountInt;
      if (maleCountInt < 0) maleCountInt = null;
    } else if (femaleCountInt == null) {
      femaleCountInt = guestCountInt - maleCountInt;
      if (femaleCountInt < 0) femaleCountInt = null;
    } else if (maleCountInt + femaleCountInt !== guestCountInt && maleCountInt + femaleCountInt === 0) {
      // Both supplied but sum to 0 against a positive guest count — fall through
      // as if unknown so the report can estimate rather than store garbage.
      maleCountInt = null;
      femaleCountInt = null;
    }

    // Origin: optional. 'Philippines' is only stored when a domestic origin is
    // actually captured (province/city present). A blank origin — foreign with
    // no country, or domestic with no province/city — stores NULL so the report
    // can distribute it over the residence categories instead of silently
    // treating it as 'Philippines, no city'.
    let resolvedCountry = null;
    let resolvedProvince = null;
    let resolvedCityMunicipality = null;
    if (isForeign) {
      if (country && String(country).trim() !== '') {
        resolvedCountry = String(country).trim();
      }
    } else {
      const provinceVal = province && String(province).trim() !== '' ? String(province).trim() : null;
      const cityVal = cityMunicipality && String(cityMunicipality).trim() !== '' ? String(cityMunicipality).trim() : null;
      if (provinceVal || cityVal) {
        resolvedCountry = 'Philippines';
        resolvedProvince = provinceVal;
        resolvedCityMunicipality = cityVal;
      }
    }

    // is_foreign: records that this entry was logged as a foreign tourist even
    // when no country was named (country stays NULL). Derived defensively so a
    // mismatched client payload can never violate the DB consistency check.
    const resolvedIsForeign = isForeign || (resolvedCountry && resolvedCountry !== 'Philippines') ? 1 : 0;

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

    // Optional client-supplied creation timestamp (offline-first devices save
    // to SQLite first and sync later; keeping their original time preserves
    // faithful created_at ordering). Formatted in server-local time to match
    // the DATETIME DEFAULT CURRENT_TIMESTAMP convention. Absent/invalid input
    // falls back to the DB default.
    let resolvedCreatedAt = null;
    if (createdAt) {
      const d = new Date(createdAt);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        resolvedCreatedAt =
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
    }

    const insertColumns = [
      'id', 'attraction_id', 'visit_date', 'guest_count',
      'male_count', 'female_count',
      'is_foreign', 'country', 'province', 'city_municipality',
    ];
    const insertValues = [
      visitEntryId,
      attractionId,
      visitDate,
      guestCountInt,
      maleCountInt,
      femaleCountInt,
      resolvedIsForeign,
      resolvedCountry,
      resolvedProvince,
      resolvedCityMunicipality,
    ];

    if (resolvedCreatedAt) {
      insertColumns.push('created_at');
      insertValues.push(resolvedCreatedAt);
    }

    const placeholders = insertColumns.map(() => '?').join(', ');

    await connection.execute(
      `INSERT INTO attraction_visit_logs (${insertColumns.join(', ')})
       VALUES (${placeholders})`,
      insertValues
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
