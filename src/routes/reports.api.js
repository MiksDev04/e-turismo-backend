import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const adminGuard = [auth.authenticate, auth.requireRole('admin')];

// ─── Country / Region Definitions ────────────────────────────────────────────
const kCountryRows = [
  { country: 'BRUNEI', daily: 36, sum: 36 },
  { country: 'CAMBODIA', daily: 37, sum: 37 },
  { country: 'INDONESIA', daily: 38, sum: 38 },
  { country: 'LAOS', daily: 39, sum: 39 },
  { country: 'MALAYSIA', daily: 40, sum: 40 },
  { country: 'MYANMAR', daily: 41, sum: 41 },
  { country: 'SINGAPORE', daily: 42, sum: 42 },
  { country: 'THAILAND', daily: 43, sum: 43 },
  { country: 'VIETNAM', daily: 44, sum: 44 },
  { country: 'CHINA', daily: 48, sum: 48 },
  { country: 'HONGKONG', daily: 49, sum: 49 },
  { country: 'JAPAN', daily: 50, sum: 50 },
  { country: 'KOREA', daily: 51, sum: 51 },
  { country: 'TAIWAN', daily: 52, sum: 52 },
  { country: 'BANGLADESH', daily: 56, sum: 56 },
  { country: 'INDIA', daily: 57, sum: 57 },
  { country: 'IRAN', daily: 58, sum: 58 },
  { country: 'NEPAL', daily: 59, sum: 59 },
  { country: 'PAKISTAN', daily: 60, sum: 60 },
  { country: 'SRI LANKA', daily: 61, sum: 61 },
  { country: 'BAHRAIN', daily: 66, sum: 65 },
  { country: 'EGYPT', daily: 67, sum: 66 },
  { country: 'ISRAEL', daily: 68, sum: 67 },
  { country: 'JORDAN', daily: 69, sum: 68 },
  { country: 'KUWAIT', daily: 70, sum: 69 },
  { country: 'SAUDI ARABIA', daily: 71, sum: 70 },
  { country: 'UNITED ARAB EMIRATES', daily: 72, sum: 71 },
  { country: 'CANADA', daily: 77, sum: 77 },
  { country: 'MEXICO', daily: 78, sum: 78 },
  { country: 'USA', daily: 79, sum: 79 },
  { country: 'ARGENTINA', daily: 83, sum: 83 },
  { country: 'BRAZIL', daily: 84, sum: 84 },
  { country: 'COLOMBIA', daily: 85, sum: 85 },
  { country: 'PERU', daily: 86, sum: 86 },
  { country: 'VENEZUELA', daily: 87, sum: 87 },
  { country: 'AUSTRIA', daily: 92, sum: 92 },
  { country: 'BELGIUM', daily: 93, sum: 93 },
  { country: 'FRANCE', daily: 94, sum: 94 },
  { country: 'GERMANY', daily: 95, sum: 95 },
  { country: 'LUXEMBOURG', daily: 96, sum: 96 },
  { country: 'NETHERLANDS', daily: 97, sum: 97 },
  { country: 'SWITZERLAND', daily: 98, sum: 98 },
  { country: 'DENMARK', daily: 102, sum: 102 },
  { country: 'FINLAND', daily: 103, sum: 103 },
  { country: 'IRELAND', daily: 104, sum: 104 },
  { country: 'NORWAY', daily: 105, sum: 105 },
  { country: 'SWEDEN', daily: 106, sum: 106 },
  { country: 'UNITED KINGDOM', daily: 107, sum: 107 },
  { country: 'GREECE', daily: 111, sum: 111 },
  { country: 'ITALY', daily: 112, sum: 112 },
  { country: 'PORTUGAL', daily: 113, sum: 113 },
  { country: 'SPAIN', daily: 114, sum: 114 },
  { country: 'UNION OF SERBIA AND MONTENEGRO', daily: 115, sum: 115 },
  { country: 'COMMONWEALTH OF INDEPENDENT STATES', daily: 119, sum: 119 },
  { country: 'POLAND', daily: 120, sum: 120 },
  { country: 'RUSSIA', daily: 121, sum: 121 },
  { country: 'AUSTRALIA', daily: 126, sum: 125 },
  { country: 'GUAM', daily: 127, sum: 126 },
  { country: 'NAURU', daily: 128, sum: 127 },
  { country: 'NEW ZEALAND', daily: 129, sum: 128 },
  { country: 'PAPUA NEW GUINEA', daily: 130, sum: 129 },
  { country: 'NIGERIA', daily: 134, sum: 135 },
  { country: 'SOUTH AFRICA', daily: 135, sum: 136 },
];

const kMonthNames = [
  '', 'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const kAccTypes = [
  { key: 'hotel', row: 10 },
  { key: 'resort', row: 11 },
  { key: 'pension_inn', row: 12 },
  { key: 'youth_hostel', row: 13 },
  { key: 'apartment', row: 14 },
  { key: 'others', row: 15 },
];

// ─── Row Mappings for Daily vs Sum Sheets ────────────────────────────────────
const kRows = {
  daily: {
    phResFilipino: 28,
    phResForeign: 29,
    phResTotal: 30,
    otherCountries: 139,
    totalForeign: 141,
    unspecified: 149,
    overseasFilipino: 143,
    grandTotal: 145,
    summaryPhTotal: 146,
    summaryForeignTotal: 147,
    summaryOverseasTotal: 148,
    roomsOccupied: 154,
    roomsAvailable: 155,
    guestNights: 156,
    occupancyRate: 158,
    alos: 159,
    maleStart: 161,
    femaleStart: 167,
  },
  sum: {
    phResFilipino: 28,
    phResForeign: 29,
    phResTotal: 30,
    otherCountries: 140,
    totalForeign: 142,
    unspecified: 150,
    overseasFilipino: 144,
    grandTotal: 146,
    summaryPhTotal: 147,
    summaryForeignTotal: 148,
    summaryOverseasTotal: 149,
    roomsOccupied: 155,
    roomsAvailable: 156,
    guestNights: 157,
    occupancyRate: 159,
    alos: 160,
    maleStart: 162,
    femaleStart: 168,
  },
};

// ─── Regional Groupings for Subtotals ────────────────────────────────────────
const kRegionalGroups = [
  { label: 'ASEAN', dailyRow: 45, sumRow: 45, countries: ['BRUNEI', 'CAMBODIA', 'INDONESIA', 'LAOS', 'MALAYSIA', 'MYANMAR', 'SINGAPORE', 'THAILAND', 'VIETNAM'] },
  { label: 'EAST ASIA', dailyRow: 53, sumRow: 53, countries: ['CHINA', 'HONGKONG', 'JAPAN', 'KOREA', 'TAIWAN'] },
  { label: 'SOUTH ASIA', dailyRow: 62, sumRow: 62, countries: ['BANGLADESH', 'INDIA', 'IRAN', 'NEPAL', 'PAKISTAN', 'SRI LANKA'] },
  { label: 'MIDDLE EAST', dailyRow: 73, sumRow: 72, countries: ['BAHRAIN', 'EGYPT', 'ISRAEL', 'JORDAN', 'KUWAIT', 'SAUDI ARABIA', 'UNITED ARAB EMIRATES'] },
  { label: 'NORTH AMERICA', dailyRow: 80, sumRow: 80, countries: ['CANADA', 'MEXICO', 'USA'] },
  { label: 'SOUTH AMERICA', dailyRow: 88, sumRow: 88, countries: ['ARGENTINA', 'BRAZIL', 'COLOMBIA', 'PERU', 'VENEZUELA'] },
  { label: 'WESTERN EUROPE', dailyRow: 99, sumRow: 99, countries: ['AUSTRIA', 'BELGIUM', 'FRANCE', 'GERMANY', 'LUXEMBOURG', 'NETHERLANDS', 'SWITZERLAND'] },
  { label: 'NORTHERN EUROPE', dailyRow: 108, sumRow: 108, countries: ['DENMARK', 'FINLAND', 'IRELAND', 'NORWAY', 'SWEDEN', 'UNITED KINGDOM'] },
  { label: 'SOUTHERN EUROPE', dailyRow: 116, sumRow: 116, countries: ['GREECE', 'ITALY', 'PORTUGAL', 'SPAIN', 'UNION OF SERBIA AND MONTENEGRO'] },
  { label: 'EASTERN EUROPE', dailyRow: 122, sumRow: 122, countries: ['COMMONWEALTH OF INDEPENDENT STATES', 'POLAND', 'RUSSIA'] },
  { label: 'AUSTRALASIA', dailyRow: 131, sumRow: 130, countries: ['AUSTRALIA', 'GUAM', 'NAURU', 'NEW ZEALAND', 'PAPUA NEW GUINEA'] },
  { label: 'AFRICA', dailyRow: 136, sumRow: 137, countries: ['NIGERIA', 'SOUTH AFRICA'] },
];

// Total column index (AG = 33).  Day 1 → col B (2), Day 31 → col AF (32),
// so the grand-total column is col AG (33).  The PDF renderer also stops at 33.
const kTotalCol = 33;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _classifyResidenceBucket({ country, nationality, isOverseas }) {
  const c = (country || '').toUpperCase();
  const n = (nationality || '').toLowerCase();

  if (!!isOverseas) return 'overseas_filipino';
  if (c === 'PHILIPPINES' || n === 'filipino') {
    return n === 'filipino' ? 'philippine_resident_filipino' : 'philippine_resident_foreign';
  }
  if (c === '' || c === 'UNKNOWN' || c === 'OTHERS') return 'unspecified_guest';
  return 'foreign_resident';
}

function _asInt(v) {
  return parseInt(v, 10) || 0;
}

// Parse date strings as LOCAL time to prevent UTC-midnight shifting dates by
// -1 day in Philippine timezone (UTC+8).
function _parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const datePart = String(dateStr).split('T')[0];
  const [y, mo, d] = datePart.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d); // local midnight — getDate() is always correct
}

// Returns the arrival count for foreign-resident countries NOT in kCountryRows
// for a given day key (0 = grand total, 1-31 = that calendar day).
function _otherCountriesTotal(countryByDay, dayKey) {
  const listed = new Set(kCountryRows.map(c => c.country));
  let total = 0;
  for (const [country, days] of Object.entries(countryByDay)) {
    if (!listed.has(country)) total += (days[dayKey] || 0);
  }
  return total;
}

// ─── FIX: Purge ALL named ranges from the workbook ───────────────────────────
function _purgeOrphanedDefinedNames(workbook) {
  try {
    const dn = workbook.definedNames;
    if (dn) dn.model = [];
  } catch (err) {
    console.warn('[report] Named-range cleanup skipped:', err.message);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// ── List report batches ─────────────────────────────────────────────────────
router.get('/reports', adminGuard, async (req, res, next) => {
  try {
    const {
      page = '1',
      pageSize = '10',
      type,
      variant,
      year,
      month,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limit   = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset  = (pageNum - 1) * limit;

    const conditions = [];
    const params     = [];

    if (type && type !== 'all') {
      conditions.push('rb.report_type = ?');
      params.push(type);
    }

    if (variant && variant !== 'all') {
      conditions.push('rb.report_variant = ?');
      params.push(variant);
    }

    if (year && year !== 'all' && year !== 'All Years') {
      conditions.push('rb.period_year = ?');
      params.push(parseInt(year, 10));
    }

    if (month && month !== 'all' && month !== 'All Months') {
      const monthIndex = [
        '', 'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ].indexOf(month);
      if (monthIndex > 0) {
        conditions.push('JSON_CONTAINS(rb.period_months, ?)');
        params.push(JSON.stringify(monthIndex));
      }
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    const [countRows] = await db.pool.query(
      `SELECT COUNT(*) as total FROM report_batches rb ${whereClause}`,
      params
    );
    const totalCount = countRows[0].total;

    if (totalCount === 0) {
      return res.json({ data: [], totalCount: 0, pageCount: 0 });
    }

    const [rows] = await db.pool.query(
      `SELECT rb.id, rb.report_type, rb.report_variant, rb.period_year,
              rb.period_months, rb.created_at, rb.last_viewed_at,
              rb.last_generated_at, rb.requested_by,
              u.full_name AS requested_by_name
       FROM report_batches rb
       LEFT JOIN users u ON rb.requested_by = u.id
       ${whereClause}
       ORDER BY rb.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map(row => {
      const months = Array.isArray(row.period_months)
        ? row.period_months
        : JSON.parse(row.period_months);
      const sortedMonths = [...months].sort((a, b) => a - b);
      const monthLabel = sortedMonths.length === 1
        ? kMonthNames[sortedMonths[0]]
        : sortedMonths.length === 12
          ? 'Full Year'
          : sortedMonths.map(m => kMonthNames[m].substring(0, 3)).join('-');

      return {
        id: row.id,
        report_type: row.report_type,
        report_variant: row.report_variant,
        period_year: row.period_year,
        period_months: sortedMonths,
        period_label: row.report_variant === 'series' && sortedMonths.length > 1
          ? `${monthLabel} ${row.period_year}`
          : sortedMonths.length === 12
            ? String(row.period_year)
            : `${monthLabel} ${row.period_year}`,
        created_at: row.created_at,
        last_viewed_at: row.last_viewed_at,
        last_generated_at: row.last_generated_at,
        requested_by_name: row.requested_by_name,
      };
    });

    res.json({ data, totalCount, pageCount: Math.ceil(totalCount / limit) });
  } catch (err) {
    next(err);
  }
});

// ── Create a report batch (no file generation) ─────────────────────────────
router.post('/reports', adminGuard, async (req, res, next) => {
  try {
    const { reportType = 'dae', reportVariant, periodYear, periodMonths } = req.body;

    if (!reportVariant || !['daily', 'summary', 'series'].includes(reportVariant)) {
      return res.status(400).json({ message: 'reportVariant must be "daily", "summary", or "series" (DAE)' });
    }
    if (!periodYear || parseInt(periodYear, 10) < 2000) {
      return res.status(400).json({ message: 'periodYear must be >= 2000' });
    }
    if (!Array.isArray(periodMonths) || periodMonths.length === 0) {
      return res.status(400).json({ message: 'periodMonths must be a non-empty array of month ints (1-12)' });
    }

    const months = [...new Set(periodMonths)].map(Number).filter(m => m >= 1 && m <= 12).sort((a, b) => a - b);

    if (['daily', 'summary'].includes(reportVariant) && months.length !== 1) {
      return res.status(400).json({ message: `"${reportVariant}" variant requires exactly one month` });
    }

    const crypto = await import('crypto');
    const monthsHash = crypto.createHash('sha256').update(JSON.stringify(months)).digest('hex');

    // Find-or-create (dedupe on type+variant+year+monthsHash)
    const [existing] = await db.pool.execute(
      `SELECT id FROM report_batches
       WHERE report_type = ? AND report_variant = ? AND period_year = ? AND period_months_hash = ?`,
      [reportType, reportVariant, parseInt(periodYear, 10), monthsHash]
    );

    if (existing.length > 0) {
      return res.status(200).json({ batchId: existing[0].id, existing: true });
    }

    const batchId = uuidv4();
    await db.pool.execute(
      `INSERT INTO report_batches (id, report_type, report_variant, period_year, period_months, requested_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [batchId, reportType, reportVariant, parseInt(periodYear, 10), JSON.stringify(months), req.user.id]
    );

    res.status(201).json({ batchId, existing: false });
  } catch (err) {
    next(err);
  }
});

// ── View report (live aggregation, returns JSON) ───────────────────────────
router.get('/reports/view', adminGuard, async (req, res, next) => {
  try {
    const { reportType = 'dae', reportVariant, periodYear, periodMonths } = req.query;

    if (!reportVariant || !['daily', 'summary', 'series'].includes(reportVariant)) {
      return res.status(400).json({ message: 'reportVariant is required (daily|summary|series)' });
    }
    if (!periodYear) {
      return res.status(400).json({ message: 'periodYear is required' });
    }

    let months;
    try {
      months = JSON.parse(periodMonths);
      if (!Array.isArray(months)) throw new Error();
    } catch {
      return res.status(400).json({ message: 'periodMonths must be a JSON array of ints' });
    }

    const sortedMonths = [...months].map(Number).sort((a, b) => a - b);

    if (['daily', 'summary'].includes(reportVariant) && sortedMonths.length !== 1) {
      return res.status(400).json({ message: `"${reportVariant}" requires exactly one month` });
    }

    const crypto = await import('crypto');
    const monthsHash = crypto.createHash('sha256').update(JSON.stringify(sortedMonths)).digest('hex');
    const year = parseInt(periodYear, 10);

    // Find-or-create batch
    const [existing] = await db.pool.execute(
      `SELECT id FROM report_batches
       WHERE report_type = ? AND report_variant = ? AND period_year = ? AND period_months_hash = ?`,
      [reportType, reportVariant, year, monthsHash]
    );

    let batchId;
    if (existing.length > 0) {
      batchId = existing[0].id;
      await db.pool.execute('UPDATE report_batches SET last_viewed_at = NOW() WHERE id = ?', [batchId]);
    } else {
      batchId = uuidv4();
      await db.pool.execute(
        `INSERT INTO report_batches (id, report_type, report_variant, period_year, period_months, requested_by, last_viewed_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [batchId, reportType, reportVariant, year, JSON.stringify(sortedMonths), req.user.id]
      );
    }

    // Fetch approved businesses
    const [businesses] = await db.pool.execute(
      `SELECT id, business_name, business_line, ae_id, region, city_municipality, province,
              (SELECT COUNT(*) FROM rooms WHERE business_id = businesses.id) AS total_rooms
       FROM businesses WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY business_name`
    );

    // Aggregate per business
    const establishments = [];
    const allMonthData = [];

    for (const biz of businesses) {
      const monthDataList = [];
      for (const m of sortedMonths) {
        const md = await _fetchMonthData(biz.id, m, year);
        monthDataList.push(md);
        allMonthData.push(md);
      }

      establishments.push({
        businessId: biz.id,
        businessName: biz.business_name,
        totalRooms: biz.total_rooms || 0,
        aeId: biz.ae_id,
        region: biz.region,
        cityMunicipality: biz.city_municipality,
        province: biz.province,
        businessLine: typeof biz.business_line === 'string'
          ? JSON.parse(biz.business_line || '[]')
          : (biz.business_line || []),
        monthData: reportVariant === 'series' ? null : monthDataList[0],
        seriesData: reportVariant === 'series'
          ? monthDataList.map(md => ({ month: md.month, data: md }))
          : null,
      });
    }

    // Compute merged totals
    let totals;
    if (sortedMonths.length === 1) {
      totals = _mergeMonthData(sortedMonths[0], allMonthData);
    } else {
      totals = _mergeMonthDataMulti(sortedMonths, allMonthData);
    }

    const totalRoomsAll = businesses.reduce((sum, b) => sum + (b.total_rooms || 0), 0);

    res.json({
      batch: { id: batchId, reportType, reportVariant, periodYear: year, periodMonths: sortedMonths },
      establishments,
      totals: { ...totals, totalRooms: totalRoomsAll },
    });
  } catch (err) {
    next(err);
  }
});

// ── Download report (generates file in memory, streams bytes) ───────────────
router.post('/reports/download', adminGuard, async (req, res, next) => {
  // TODO: large annual series across many establishments may be slow on free tier
  try {
    const { reportType = 'dae', reportVariant, periodYear, periodMonths, format = 'xlsx' } = req.body;

    if (!reportVariant || !['daily', 'summary', 'series'].includes(reportVariant)) {
      return res.status(400).json({ message: 'reportVariant must be "daily", "summary", or "series"' });
    }
    if (!periodYear) {
      return res.status(400).json({ message: 'periodYear is required' });
    }
    if (!['xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ message: 'format must be "xlsx" or "pdf"' });
    }

    let months;
    try {
      months = JSON.parse(periodMonths);
      if (!Array.isArray(months)) throw new Error();
    } catch {
      return res.status(400).json({ message: 'periodMonths must be a JSON array of ints' });
    }

    const sortedMonths = [...months].map(Number).sort((a, b) => a - b);

    if (['daily', 'summary'].includes(reportVariant) && sortedMonths.length !== 1) {
      return res.status(400).json({ message: `"${reportVariant}" requires exactly one month` });
    }

    const year = parseInt(periodYear, 10);
    const crypto = await import('crypto');
    const monthsHash = crypto.createHash('sha256').update(JSON.stringify(sortedMonths)).digest('hex');

    // Find-or-create batch
    const [existing] = await db.pool.execute(
      `SELECT id FROM report_batches
       WHERE report_type = ? AND report_variant = ? AND period_year = ? AND period_months_hash = ?`,
      [reportType, reportVariant, year, monthsHash]
    );

    let batchId;
    if (existing.length > 0) {
      batchId = existing[0].id;
    } else {
      batchId = uuidv4();
      await db.pool.execute(
        `INSERT INTO report_batches (id, report_type, report_variant, period_year, period_months, requested_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [batchId, reportType, reportVariant, year, JSON.stringify(sortedMonths), req.user.id]
      );
    }

    // ── Aggregate (reuse same logic as /view) ─────────────────────────────────
    const [businesses] = await db.pool.execute(
      `SELECT id, business_name, business_line, ae_id, region, city_municipality, province,
              owner_first_name, owner_last_name, owner_middle_name,
              (SELECT COUNT(*) FROM rooms WHERE business_id = businesses.id) AS total_rooms
       FROM businesses WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY business_name`
    );

    const [userRows] = await db.pool.execute('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
    const adminName = userRows[0]?.full_name || 'System Admin';

    const daysInMonth = sortedMonths.length === 1 ? new Date(year, sortedMonths[0], 0).getDate() : 0;
    const allBizMonthData = [];
    const allBizAnnualData = [];
    let totalRoomsSum = 0;
    const unionLines = new Set();
    const monthLabel = sortedMonths.length === 1
      ? String(sortedMonths[0]).padStart(2, '0')
      : sortedMonths.length === 12 ? 'FULL' : sortedMonths.join('-');

    // ── Build workbooks ───────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();

    for (const biz of businesses) {
      let bizAllMonths = null;
      if (reportVariant === 'series' && sortedMonths.length > 1) {
        // Fetch all requested months for this business
        bizAllMonths = [];
        for (const m of sortedMonths) {
          const md = await _fetchMonthData(biz.id, m, year);
          bizAllMonths.push(md);
          allBizMonthData.push(md);
        }
      } else if (sortedMonths.length === 1) {
        const md = await _fetchMonthData(biz.id, sortedMonths[0], year);
        allBizMonthData.push(md);
        bizAllMonths = [md];
      }

      totalRoomsSum += biz.total_rooms || 0;
      if (Array.isArray(biz.business_line)) biz.business_line.forEach(l => unionLines.add(l));

      if (reportVariant === 'daily' && bizAllMonths?.[0]) {
        const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
        const sheet = wb.addWorksheet(sheetName);
        _buildDailySheet(sheet, biz, bizAllMonths[0], sortedMonths[0], year, daysInMonth, adminName);
      }

      if (reportVariant === 'summary' && bizAllMonths?.[0]) {
        const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
        const sheet = wb.addWorksheet(sheetName);
        _buildCountrySummarySheet(sheet, bizAllMonths[0], biz.total_rooms, sortedMonths[0], year,
          daysInMonth, adminName, biz.city_municipality || '', biz.province || '', biz.business_name, biz);
      }

      if (reportVariant === 'series' && bizAllMonths && bizAllMonths.length > 1) {
        const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
        const sheet = wb.addWorksheet(sheetName);
        _buildMonthlySummarySheet(sheet, bizAllMonths, biz.total_rooms, year, adminName,
          biz.city_municipality || '', biz.province || '', biz.business_name, biz);
      }
    }

    // ── Totals sheet (across all businesses) ──────────────────────────────────
    const totalBiz = {
      business_name: 'TOTAL \u2013 ALL ACCOMMODATION',
      total_rooms: totalRoomsSum,
      business_line: [...unionLines],
      region: '', city_municipality: 'San Pablo City', province: 'Laguna',
    };

    if (reportVariant === 'daily' && allBizMonthData.length > 0) {
      const mergedMd = _mergeMonthData(sortedMonths[0], allBizMonthData);
      const sheet = wb.addWorksheet('TOTAL \u2013 ALL ACCOMMODATION');
      _buildDailySheet(sheet, totalBiz, mergedMd, sortedMonths[0], year, daysInMonth, adminName);
    }

    if (reportVariant === 'summary' && allBizMonthData.length > 0) {
      const mergedMd = _mergeMonthData(sortedMonths[0], allBizMonthData);
      const sheet = wb.addWorksheet('TOTAL \u2013 ALL ACCOMMODATION');
      _buildCountrySummarySheet(sheet, mergedMd, totalRoomsSum, sortedMonths[0], year,
        daysInMonth, adminName, 'San Pablo City', 'Laguna', totalBiz.business_name, totalBiz);
    }

    if (reportVariant === 'series' && allBizMonthData.length > 0) {
      const mergedMonths = [];
      for (const m of sortedMonths) {
        const monthDataList = allBizMonthData.filter(md => md.month === m);
        mergedMonths.push(_mergeMonthData(m, monthDataList));
      }
      const sheet = wb.addWorksheet('TOTAL \u2013 ALL ACCOMMODATION');
      _buildMonthlySummarySheet(sheet, mergedMonths, totalRoomsSum, year, adminName,
        'San Pablo City', 'Laguna', totalBiz.business_name, totalBiz);
    }

    _purgeOrphanedDefinedNames(wb);
    wb.eachSheet(ws => {
      if (ws.pageSetup) {
        ws.pageSetup.printArea = null;
        delete ws.pageSetup.printTitlesRow;
        delete ws.pageSetup.printTitlesColumn;
      }
    });

    // ── Generate file ───────────────────────────────────────────────────────
    const safeMonths = sortedMonths.join('-');
    const baseFilename = `DAE_${reportVariant}_${year}_${safeMonths}`;

    if (format === 'xlsx') {
      const buffer = await wb.xlsx.writeBuffer();
      await db.pool.execute('UPDATE report_batches SET last_generated_at = NOW() WHERE id = ?', [batchId]);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="${baseFilename}.xlsx"`);
      res.send(Buffer.from(buffer));
    } else {
      const pdfBuffer = await _generatePdfBuffer(wb, sortedMonths[0], year);
      await db.pool.execute('UPDATE report_batches SET last_generated_at = NOW() WHERE id = ?', [batchId]);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
      res.send(pdfBuffer);
    }
  } catch (err) {
    console.error('Report download error:', err);
    // Error must be sent BEFORE any binary headers are set
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || 'Failed to generate report' });
    }
  }
});

// ─── Data Fetching (new schema: guest_records lead fields + guest_record_rooms) ─

async function _fetchMonthData(businessId, month, year, includeArchived = false) {
  const firstDay    = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay     = new Date(year, month, 0).toISOString().split('T')[0];
  const statusFilter = includeArchived
    ? "AND status IN ('active', 'archived')"
    : "AND status = 'active'";

  const [records] = await db.pool.execute(
    `SELECT id, check_in, check_out, total_guests,
            lead_country, lead_sex, lead_nationality, lead_is_overseas
     FROM guest_records
     WHERE business_id = ? AND is_deleted = false
       AND check_in >= ? AND check_in <= ? ${statusFilter}`,
    [businessId, firstDay, lastDay]
  );

  // Fetch room assignments to compute rooms_occupied per record
  const recordIds = records.map(r => r.id);
  let roomCounts = {};
  if (recordIds.length > 0) {
    const [grrRows] = await db.pool.execute(
      `SELECT guest_record_id, COUNT(DISTINCT room_id) AS room_count
       FROM guest_record_rooms
       WHERE guest_record_id IN (${recordIds.map(() => '?').join(',')})
       GROUP BY guest_record_id`,
      recordIds
    );
    grrRows.forEach(r => { roomCounts[r.guest_record_id] = r.room_count; });
  }

  // Precompute check-in day in LOCAL time
  const recordDay = {};
  records.forEach(r => {
    const d = _parseLocalDate(r.check_in);
    if (d) recordDay[r.id] = d.getDate();
  });

  const countryByDay            = {};
  const residentsByDay          = { 0: {} };
  const sexByDay                = { 0: { male: {}, female: {} } };
  const roomsOccupiedByDay      = {};
  const guestNightsByDay        = {};
  const guestNightsPerArrivalDay = {};
  let totalGuestNights = 0;

  // ── Night / room calculations ──────────────────────────────────────────────
  records.forEach(r => {
    const checkIn = _parseLocalDate(r.check_in);
    if (!checkIn) return;
    if (!r.check_out) return;

    const checkOut  = _parseLocalDate(r.check_out);
    const nights    = Math.max(0, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
    const rooms     = roomCounts[r.id] || 0;
    const guestCount = r.total_guests || 0;
    const day       = checkIn.getDate();

    if (nights > 0) {
      totalGuestNights += nights * guestCount;
      guestNightsPerArrivalDay[day] = (guestNightsPerArrivalDay[day] || 0) + (nights * guestCount);
    }

    // Spread rooms-occupied across each stay-night
    const spreadDays = Math.max(1, nights);
    for (let n = 0; n < spreadDays; n++) {
      const stayDate = new Date(checkIn);
      stayDate.setDate(checkIn.getDate() + n);
      if (stayDate.getFullYear() === year && (stayDate.getMonth() + 1) === month) {
        const stayDay = stayDate.getDate();
        roomsOccupiedByDay[stayDay] = (roomsOccupiedByDay[stayDay] || 0) + rooms;
        if (nights > 0) {
          guestNightsByDay[stayDay] = (guestNightsByDay[stayDay] || 0) + guestCount;
        }
      }
    }
  });

  const listedSet = new Set(kCountryRows.map(c => c.country));

  // ── Arrival / residency / country tallies (from lead guest fields) ─────────
  records.forEach(r => {
    const day = recordDay[r.id];
    if (!day) return;

    const country     = (r.lead_country || '').toUpperCase();
    const nationality = (r.lead_nationality || '');
    const sex         = (r.lead_sex || '').toLowerCase();
    const rawBucket   = _classifyResidenceBucket({ country, nationality, isOverseas: !!r.lead_is_overseas });
    const count       = _asInt(r.total_guests);

    // All foreign residents go into countryByDay
    if (rawBucket === 'foreign_resident' && country) {
      if (!countryByDay[country]) countryByDay[country] = { 0: 0 };
      countryByDay[country][day] = (countryByDay[country][day] || 0) + count;
      countryByDay[country][0]   = (countryByDay[country][0]   || 0) + count;
    }

    // Determine final bucket for summary tallies
    let bucket = rawBucket;
    if (rawBucket === 'foreign_resident') {
      bucket = listedSet.has(country) ? 'listed_foreign_resident' : 'unlisted_foreign_resident';
    }

    // Residency bucket totals
    residentsByDay[day] = residentsByDay[day] || {};
    residentsByDay[day][bucket] = (residentsByDay[day][bucket] || 0) + count;
    residentsByDay[0][bucket]   = (residentsByDay[0][bucket]   || 0) + count;

    // Sex × residency breakdown
    sexByDay[day] = sexByDay[day] || { male: {}, female: {} };
    if (!sexByDay[day][sex])   sexByDay[day][sex] = {};
    if (!sexByDay[0][sex])     sexByDay[0][sex]   = {};
    sexByDay[day][sex][bucket] = (sexByDay[day][sex][bucket] || 0) + count;
    sexByDay[0][sex][bucket]   = (sexByDay[0][sex][bucket]   || 0) + count;
  });

  return {
    month,
    countryByDay,
    residentsByDay,
    sexByDay,
    roomsOccupied: roomsOccupiedByDay,
    guestNightsByDay,
    guestNightsPerArrivalDay,
    guestNights: totalGuestNights,
  };
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function _mergeMonthData(month, list) {
  const countryByDay             = {};
  const residentsByDay           = { 0: {} };
  const sexByDay                 = { 0: { male: {}, female: {} } };
  const roomsOccupied            = {};
  const guestNightsByDay         = {};
  const guestNightsPerArrivalDay = {};
  let guestNights = 0;

  list.forEach(md => {
    Object.entries(md.countryByDay).forEach(([country, days]) => {
      countryByDay[country] = countryByDay[country] || {};
      Object.entries(days).forEach(([day, count]) => {
        countryByDay[country][day] = (countryByDay[country][day] || 0) + count;
      });
    });
    Object.entries(md.residentsByDay).forEach(([day, cats]) => {
      residentsByDay[day] = residentsByDay[day] || {};
      Object.entries(cats).forEach(([cat, count]) => {
        residentsByDay[day][cat] = (residentsByDay[day][cat] || 0) + count;
      });
    });
    Object.entries(md.sexByDay).forEach(([day, sexMap]) => {
      sexByDay[day] = sexByDay[day] || { male: {}, female: {} };
      Object.entries(sexMap).forEach(([s, cats]) => {
        sexByDay[day][s] = sexByDay[day][s] || {};
        Object.entries(cats).forEach(([cat, count]) => {
          sexByDay[day][s][cat] = (sexByDay[day][s][cat] || 0) + count;
        });
      });
    });
    Object.entries(md.roomsOccupied).forEach(([day, count]) => {
      roomsOccupied[day] = (roomsOccupied[day] || 0) + count;
    });
    Object.entries(md.guestNightsByDay).forEach(([day, count]) => {
      guestNightsByDay[day] = (guestNightsByDay[day] || 0) + count;
    });
    Object.entries(md.guestNightsPerArrivalDay).forEach(([day, count]) => {
      guestNightsPerArrivalDay[day] = (guestNightsPerArrivalDay[day] || 0) + count;
    });
    guestNights += md.guestNights;
  });

  return {
    month, countryByDay, residentsByDay, sexByDay,
    roomsOccupied, guestNightsByDay, guestNightsPerArrivalDay, guestNights,
  };
}

function _mergeMonthDataMulti(months, list) {
  const byMonth = {};
  months.forEach(m => { byMonth[m] = []; });
  list.forEach(md => {
    if (byMonth[md.month]) byMonth[md.month].push(md);
  });

  const result = {};
  for (const m of months) {
    result[m] = _mergeMonthData(m, byMonth[m] || []);
  }
  return result;
}

// ─── Sheet Property Copy ─────────────────────────────────────────────────────

function _copySheetProperties(src, dst) {
  if (src.properties) dst.properties = JSON.parse(JSON.stringify(src.properties));
  if (src.pageSetup)  dst.pageSetup  = JSON.parse(JSON.stringify(src.pageSetup));
  if (src.views)      dst.views      = JSON.parse(JSON.stringify(src.views));

  if (src.columns) {
    dst.columns = src.columns.map(c => ({
      width:  c.width,
      header: c.header,
      key:    c.key,
      style:  c.style ? JSON.parse(JSON.stringify(c.style)) : undefined,
    }));
  }

  src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const dstRow = dst.getRow(rowNumber);
    dstRow.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const dstCell = dstRow.getCell(colNumber);

      if (cell.type === ExcelJS.ValueType.Formula) {
        if (cell.formula && cell.formula.includes('!')) {
          dstCell.value = cell.result ?? 0;
        } else {
          dstCell.value = {
            formula: cell.formula,
            result:  cell.result
          };
        }
      } else {
        dstCell.value = cell.value;
      }

      if (cell.style) dstCell.style = JSON.parse(JSON.stringify(cell.style));
    });
  });

  if (src._merges) {
    Object.values(src._merges).forEach(m => {
      try {
        dst.mergeCells(m.model.top, m.model.left, m.model.bottom, m.model.right);
      } catch (e) {
        // Ignore overlapping-merge errors from template
      }
    });
  }
}

// ─── Excel Builders ──────────────────────────────────────────────────────────

// ==============================================================================================
// ======================================== DAILY SHEET =========================================
// ==============================================================================================

function _buildDailySheet(sheet, biz, md, month, year, daysInMonth, adminName) {
  const r = kRows.daily;

  sheet.getCell('B3').value = {
    richText: [
      { text: 'Region: ' },
      { font: { bold: true, underline: true, size: 10, name: 'Arial' }, text: biz.region || '4-A' },
    ],
  };
  sheet.getCell('A4').value = biz.business_name;
  sheet.getCell('A5').value = `     ${kMonthNames[month]}, ${year}    `;

  const bizLines = typeof biz.business_line === 'string'
    ? JSON.parse(biz.business_line || '[]')
    : (biz.business_line || []);
  kAccTypes.forEach(t => {
    if (bizLines.includes(t.key)) {
      sheet.getCell(`B${t.row}`).value     = '\u2714';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  sheet.getCell('A22').value = `City/Municipality: ${biz.city_municipality || ''}`;
  sheet.getCell('A23').value = `Province: ${biz.province || ''}`;

  const setDayValues = (rowNum, fn) => {
    for (let d = 1; d <= 31; d++) {
      sheet.getCell(rowNum, d + 1).value = d > daysInMonth ? null : (fn(d) ?? 0);
    }
  };

  const res = (d, cat)     => md.residentsByDay[d]?.[cat] || 0;
  const cnt = (country, d) => md.countryByDay[country.toUpperCase()]?.[d] || 0;
  const sex = (d, s, cat)  => md.sexByDay[d]?.[s]?.[cat] || 0;

  setDayValues(r.phResFilipino, d => res(d, 'philippine_resident_filipino'));
  setDayValues(r.phResForeign, d => res(d, 'philippine_resident_foreign'));
  setDayValues(r.phResTotal, d => res(d, 'philippine_resident_filipino') + res(d, 'philippine_resident_foreign'));

  kCountryRows.forEach(c => setDayValues(c.daily, d => cnt(c.country, d)));

  kRegionalGroups.forEach(g => {
    setDayValues(g.dailyRow, d => g.countries.reduce((sum, country) => sum + cnt(country, d), 0));
  });

  setDayValues(r.otherCountries, d => res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));
  setDayValues(r.totalForeign, d => res(d, 'listed_foreign_resident') + res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));
  setDayValues(r.unspecified, d => res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));
  setDayValues(r.overseasFilipino, d => res(d, 'overseas_filipino'));

  setDayValues(r.grandTotal, d => {
    return res(d, 'philippine_resident_filipino') +
           res(d, 'philippine_resident_foreign') +
           res(d, 'listed_foreign_resident') +
           res(d, 'unlisted_foreign_resident') +
           res(d, 'unspecified_guest') +
           res(d, 'overseas_filipino');
  });

  setDayValues(r.summaryPhTotal, d => res(d, 'philippine_resident_filipino') + res(d, 'philippine_resident_foreign'));
  setDayValues(r.summaryForeignTotal, d => res(d, 'listed_foreign_resident') + res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));
  setDayValues(r.summaryOverseasTotal, d => res(d, 'overseas_filipino'));

  setDayValues(r.roomsOccupied, d => md.roomsOccupied[d] || 0);
  setDayValues(r.roomsAvailable, () => biz.total_rooms);
  setDayValues(r.guestNights, d => md.guestNightsByDay[d] || 0);

  setDayValues(r.occupancyRate, d => {
    if (!biz.total_rooms) return 0;
    return parseFloat(((md.roomsOccupied[d] || 0) / biz.total_rooms * 100).toFixed(2));
  });
  setDayValues(r.alos, d => {
    const arrivals = Object.values(md.residentsByDay[d] || {}).reduce((a, b) => a + b, 0);
    if (!arrivals) return 0;
    return parseFloat(((md.guestNightsPerArrivalDay[d] || 0) / arrivals).toFixed(2));
  });

  const setSexValues = (rowStart, gender) => {
    setDayValues(rowStart + 1, d => sex(d, gender, 'philippine_resident_filipino') + sex(d, gender, 'philippine_resident_foreign'));
    setDayValues(rowStart + 2, d => sex(d, gender, 'listed_foreign_resident') + sex(d, gender, 'unlisted_foreign_resident') + sex(d, gender, 'unspecified_guest'));
    setDayValues(rowStart + 3, d => sex(d, gender, 'overseas_filipino'));
    setDayValues(rowStart + 4, d => sex(d, gender, 'unlisted_foreign_resident') + sex(d, gender, 'unspecified_guest'));
    setDayValues(rowStart + 5, d => {
      return sex(d, gender, 'philippine_resident_filipino') +
             sex(d, gender, 'philippine_resident_foreign') +
             sex(d, gender, 'listed_foreign_resident') +
             sex(d, gender, 'unlisted_foreign_resident') +
             sex(d, gender, 'overseas_filipino') +
             sex(d, gender, 'unspecified_guest');
    });
  };
  setSexValues(r.maleStart, 'male');
  setSexValues(r.femaleStart, 'female');

  // ── Total column (AG = kTotalCol) ──────────────────────────────────────────
  const writeTotal = (rowNum, value) => {
    sheet.getCell(rowNum, kTotalCol).value = value ?? 0;
  };

  const phTotal = (md.residentsByDay[0]?.['philippine_resident_filipino'] ?? 0) + 
                  (md.residentsByDay[0]?.['philippine_resident_foreign'] ?? 0);
  const listedForeignTotal = md.residentsByDay[0]?.['listed_foreign_resident'] ?? 0;
  const unlistedForeignTotal = md.residentsByDay[0]?.['unlisted_foreign_resident'] ?? 0;
  const unspecifiedTotal = md.residentsByDay[0]?.['unspecified_guest'] ?? 0;
  const overseasTotal = md.residentsByDay[0]?.['overseas_filipino'] ?? 0;
  const grandTotalAll = phTotal + listedForeignTotal + unlistedForeignTotal + unspecifiedTotal + overseasTotal;

  writeTotal(r.phResFilipino, md.residentsByDay[0]?.['philippine_resident_filipino'] ?? 0);
  writeTotal(r.phResForeign, md.residentsByDay[0]?.['philippine_resident_foreign'] ?? 0);
  writeTotal(r.phResTotal, phTotal);

  kCountryRows.forEach(c => writeTotal(c.daily, md.countryByDay[c.country]?.[0] ?? 0));

  kRegionalGroups.forEach(g => {
    const subtotal = g.countries.reduce((sum, country) => sum + (md.countryByDay[country.toUpperCase()]?.[0] ?? 0), 0);
    writeTotal(g.dailyRow, subtotal);
  });

  writeTotal(r.otherCountries, unlistedForeignTotal + unspecifiedTotal);
  writeTotal(r.totalForeign, listedForeignTotal + unlistedForeignTotal + unspecifiedTotal);
  writeTotal(r.unspecified, unlistedForeignTotal + unspecifiedTotal);
  writeTotal(r.overseasFilipino, overseasTotal);
  writeTotal(r.grandTotal, grandTotalAll);

  writeTotal(r.summaryPhTotal, phTotal);
  writeTotal(r.summaryForeignTotal, listedForeignTotal + unlistedForeignTotal + unspecifiedTotal);
  writeTotal(r.summaryOverseasTotal, overseasTotal);

  const totalRoomsOccAll = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalRoomsAvail  = (biz.total_rooms || 0) * daysInMonth;
  writeTotal(r.roomsOccupied, totalRoomsOccAll);
  writeTotal(r.roomsAvailable, totalRoomsAvail);
  writeTotal(r.guestNights, md.guestNights);
  writeTotal(r.occupancyRate, totalRoomsAvail > 0
    ? parseFloat((totalRoomsOccAll / totalRoomsAvail * 100).toFixed(2))
    : 0
  );
  const grandTotalArrivals = Object.values(md.residentsByDay[0] ?? {}).reduce((a, b) => a + b, 0);
  writeTotal(r.alos, grandTotalArrivals > 0
    ? parseFloat((md.guestNights / grandTotalArrivals).toFixed(2))
    : 0
  );

  writeTotal(r.maleStart + 1, sex(0, 'male', 'philippine_resident_filipino') + sex(0, 'male', 'philippine_resident_foreign'));
  writeTotal(r.maleStart + 2, sex(0, 'male', 'listed_foreign_resident') + sex(0, 'male', 'unlisted_foreign_resident') + sex(0, 'male', 'unspecified_guest'));
  writeTotal(r.maleStart + 3, sex(0, 'male', 'overseas_filipino'));
  writeTotal(r.maleStart + 4, sex(0, 'male', 'unlisted_foreign_resident') + sex(0, 'male', 'unspecified_guest'));
  writeTotal(r.maleStart + 5, sex(0, 'male', 'philippine_resident_filipino') + sex(0, 'male', 'philippine_resident_foreign') +
                              sex(0, 'male', 'listed_foreign_resident') + sex(0, 'male', 'unlisted_foreign_resident') +
                              sex(0, 'male', 'overseas_filipino') + sex(0, 'male', 'unspecified_guest'));

  writeTotal(r.femaleStart + 1, sex(0, 'female', 'philippine_resident_filipino') + sex(0, 'female', 'philippine_resident_foreign'));
  writeTotal(r.femaleStart + 2, sex(0, 'female', 'listed_foreign_resident') + sex(0, 'female', 'unlisted_foreign_resident') + sex(0, 'female', 'unspecified_guest'));
  writeTotal(r.femaleStart + 3, sex(0, 'female', 'overseas_filipino'));
  writeTotal(r.femaleStart + 4, sex(0, 'female', 'unlisted_foreign_resident') + sex(0, 'female', 'unspecified_guest'));
  writeTotal(r.femaleStart + 5, sex(0, 'female', 'philippine_resident_filipino') + sex(0, 'female', 'philippine_resident_foreign') +
                                sex(0, 'female', 'listed_foreign_resident') + sex(0, 'female', 'unlisted_foreign_resident') +
                                sex(0, 'female', 'overseas_filipino') + sex(0, 'female', 'unspecified_guest'));
}

// ==============================================================================================
// ======================================== COUNTRY SUM =========================================
// ==============================================================================================

function _buildCountrySummarySheet(sheet, md, totalRoomsAll, month, year, daysInMonth, adminName, city, province, businessName, biz) {
  const r = kRows.sum;

  sheet.getCell('B3').value = 'Region: __4-A';
  sheet.getCell('A4').value = businessName;
  sheet.getCell('A5').value = `${kMonthNames[month]}, ${year}`;

  sheet.getCell('A22').value = `City/Municipality: ${city || ''}`;
  sheet.getCell('A23').value = `Province: ${province || ''}`;

  const bizLines = typeof biz?.business_line === 'string'
    ? JSON.parse(biz.business_line || '[]')
    : (biz?.business_line || []);
  kAccTypes.forEach(t => {
    if (bizLines.includes(t.key)) {
      sheet.getCell(`B${t.row}`).value     = '\u2714';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  const res = cat     => md.residentsByDay[0]?.[cat] || 0;
  const cnt = country => md.countryByDay[country.toUpperCase()]?.[0] || 0;
  const sex = (s, cat) => md.sexByDay[0]?.[s]?.[cat] || 0;

  sheet.getCell(`B${r.phResFilipino}`).value = res('philippine_resident_filipino');
  sheet.getCell(`B${r.phResForeign}`).value = res('philippine_resident_foreign');
  sheet.getCell(`B${r.phResTotal}`).value = res('philippine_resident_filipino') + res('philippine_resident_foreign');

  kCountryRows.forEach(c => { sheet.getCell(`B${c.sum}`).value = cnt(c.country); });

  kRegionalGroups.forEach(g => {
    const subtotal = g.countries.reduce((sum, country) => sum + cnt(country), 0);
    sheet.getCell(`B${g.sumRow}`).value = subtotal;
  });

  const othersAndUnspecifiedTotal = res('unlisted_foreign_resident') + res('unspecified_guest');
  sheet.getCell(`B${r.otherCountries}`).value = othersAndUnspecifiedTotal;
  sheet.getCell(`B${r.totalForeign}`).value = res('listed_foreign_resident') + res('unlisted_foreign_resident') + res('unspecified_guest');
  sheet.getCell(`B${r.unspecified}`).value = othersAndUnspecifiedTotal;
  sheet.getCell(`B${r.overseasFilipino}`).value = res('overseas_filipino');

  const grandTotal =
    res('philippine_resident_filipino') +
    res('philippine_resident_foreign') +
    res('listed_foreign_resident') +
    res('unlisted_foreign_resident') +
    res('unspecified_guest') +
    res('overseas_filipino');
  sheet.getCell(`B${r.grandTotal}`).value = grandTotal;

  sheet.getCell(`B${r.summaryPhTotal}`).value = res('philippine_resident_filipino') + res('philippine_resident_foreign');
  sheet.getCell(`B${r.summaryForeignTotal}`).value = res('listed_foreign_resident') + res('unlisted_foreign_resident') + res('unspecified_guest');
  sheet.getCell(`B${r.summaryOverseasTotal}`).value = res('overseas_filipino');

  const totalRoomsOcc  = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalAvailRoom = totalRoomsAll * daysInMonth;
  sheet.getCell(`B${r.roomsOccupied}`).value = totalRoomsOcc;
  sheet.getCell(`B${r.roomsAvailable}`).value = totalAvailRoom;
  sheet.getCell(`B${r.guestNights}`).value = md.guestNights;

  sheet.getCell(`B${r.occupancyRate}`).value = totalAvailRoom > 0
    ? parseFloat((totalRoomsOcc / totalAvailRoom * 100).toFixed(2))
    : 0;
  sheet.getCell(`B${r.alos}`).value = grandTotal > 0
    ? parseFloat((md.guestNights / grandTotal).toFixed(2))
    : 0;

  const setSexValues = (rowStart, gender) => {
    sheet.getCell(`B${rowStart + 1}`).value = sex(gender, 'philippine_resident_filipino') + sex(gender, 'philippine_resident_foreign');
    sheet.getCell(`B${rowStart + 2}`).value = sex(gender, 'listed_foreign_resident') + sex(gender, 'unlisted_foreign_resident') + sex(gender, 'unspecified_guest');
    sheet.getCell(`B${rowStart + 3}`).value = sex(gender, 'overseas_filipino');
    sheet.getCell(`B${rowStart + 4}`).value = sex(gender, 'unlisted_foreign_resident') + sex(gender, 'unspecified_guest');
    sheet.getCell(`B${rowStart + 5}`).value = 
      sex(gender, 'philippine_resident_filipino') +
      sex(gender, 'philippine_resident_foreign') +
      sex(gender, 'listed_foreign_resident') +
      sex(gender, 'unlisted_foreign_resident') +
      sex(gender, 'overseas_filipino') +
      sex(gender, 'unspecified_guest');
  };
  setSexValues(r.maleStart, 'male');
  setSexValues(r.femaleStart, 'female');
}

// ==============================================================================================
// ======================================== MONTHLY SUMMARY ======================================
// ==============================================================================================

function _buildMonthlySummarySheet(sheet, allMonths, totalRoomsAll, year, adminName, city, province, businessName, biz) {
  const r = kRows.sum;

  sheet.getCell('B3').value = 'Region: __4-A';
  sheet.getCell('A4').value = businessName;
  sheet.getCell('A5').value = `${year}`;

  sheet.getCell('A22').value = `City/Municipality: ${city || ''}`;
  sheet.getCell('A23').value = `Province: ${province || ''}`;

  const bizLines = typeof biz?.business_line === 'string'
    ? JSON.parse(biz.business_line || '[]')
    : (biz?.business_line || []);
  kAccTypes.forEach(t => {
    if (bizLines.includes(t.key)) {
      sheet.getCell(`B${t.row}`).value     = '\u2714';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  const setMonthValues = (rowNum, fn) => {
    let yearTotal = 0;
    for (let i = 0; i < allMonths.length; i++) {
      const val = fn(allMonths[i].month) ?? 0;
      sheet.getCell(rowNum, i + 2).value = val;
      if (typeof val === 'number') yearTotal += val;
    }
    sheet.getCell(rowNum, allMonths.length + 2).value = yearTotal;
  };

  const mdFor = m => allMonths.find(x => x.month === m) || {
    countryByDay: {}, residentsByDay: { 0: {} },
    sexByDay: { 0: { male: {}, female: {} } },
    roomsOccupied: {}, guestNights: 0,
  };
  const mRes = (m, cat)     => mdFor(m).residentsByDay[0]?.[cat] || 0;
  const mCnt = (country, m) => mdFor(m).countryByDay[country.toUpperCase()]?.[0] || 0;
  const mSex = (m, s, cat)  => mdFor(m).sexByDay[0]?.[s]?.[cat] || 0;

  setMonthValues(r.phResFilipino, m => mRes(m, 'philippine_resident_filipino'));
  setMonthValues(r.phResForeign, m => mRes(m, 'philippine_resident_foreign'));
  setMonthValues(r.phResTotal, m => mRes(m, 'philippine_resident_filipino') + mRes(m, 'philippine_resident_foreign'));

  kCountryRows.forEach(c => setMonthValues(c.sum, m => mCnt(c.country, m)));

  kRegionalGroups.forEach(g => {
    setMonthValues(g.sumRow, m => g.countries.reduce((sum, country) => sum + mCnt(country, m), 0));
  });

  setMonthValues(r.otherCountries, m => {
    const md = mdFor(m);
    return (md.residentsByDay[0]?.['unlisted_foreign_resident'] || 0) + (md.residentsByDay[0]?.['unspecified_guest'] || 0);
  });
  setMonthValues(r.totalForeign, m => {
    const res = mdFor(m).residentsByDay[0] || {};
    return (res['listed_foreign_resident'] || 0) + (res['unlisted_foreign_resident'] || 0) + (res['unspecified_guest'] || 0);
  });
  setMonthValues(r.unspecified, m => {
    const md = mdFor(m);
    return (md.residentsByDay[0]?.['unlisted_foreign_resident'] || 0) + (md.residentsByDay[0]?.['unspecified_guest'] || 0);
  });
  setMonthValues(r.overseasFilipino, m => mRes(m, 'overseas_filipino'));

  setMonthValues(r.grandTotal, m => {
    const md = mdFor(m).residentsByDay[0] || {};
    return (md.philippine_resident_filipino || 0) +
           (md.philippine_resident_foreign || 0) +
           (md.listed_foreign_resident || 0) +
           (md.unlisted_foreign_resident || 0) +
           (md.unspecified_guest || 0) +
           (md.overseas_filipino || 0);
  });

  setMonthValues(r.summaryPhTotal, m => mRes(m, 'philippine_resident_filipino') + mRes(m, 'philippine_resident_foreign'));
  setMonthValues(r.summaryForeignTotal, m => {
    const res = mdFor(m).residentsByDay[0] || {};
    return (res['listed_foreign_resident'] || 0) + (res['unlisted_foreign_resident'] || 0) + (res['unspecified_guest'] || 0);
  });
  setMonthValues(r.summaryOverseasTotal, m => mRes(m, 'overseas_filipino'));

  setMonthValues(r.roomsOccupied, m => Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0));
  setMonthValues(r.roomsAvailable, m => totalRoomsAll * new Date(year, m, 0).getDate());
  setMonthValues(r.guestNights, m => mdFor(m).guestNights);

  for (let i = 0; i < allMonths.length; i++) {
    const m = allMonths[i].month;
    const daysInM    = new Date(year, m, 0).getDate();
    const totalAvail = totalRoomsAll * daysInM;
    const totalOcc   = Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0);
    sheet.getCell(r.occupancyRate, i + 2).value = totalAvail > 0
      ? parseFloat((totalOcc / totalAvail * 100).toFixed(2))
      : 0;

    const md = mdFor(m).residentsByDay[0] || {};
    const gt =
      (md.philippine_resident_filipino || 0) +
      (md.philippine_resident_foreign || 0) +
      (md.listed_foreign_resident || 0) +
      (md.unlisted_foreign_resident || 0) +
      (md.unspecified_guest || 0) +
      (md.overseas_filipino || 0);
    sheet.getCell(r.alos, i + 2).value = gt > 0
      ? parseFloat((mdFor(m).guestNights / gt).toFixed(2))
      : 0;
  }

  // Yearly totals for metrics
  const lastCol = allMonths.length + 2;
  const yrOccTotal = allMonths.reduce((sum, m) => sum + Object.values(m.roomsOccupied).reduce((a, b) => a + b, 0), 0);
  const yrAvailTotal = allMonths.reduce((sum, m) => sum + totalRoomsAll * new Date(year, m.month, 0).getDate(), 0);
  sheet.getCell(r.occupancyRate, lastCol).value = yrAvailTotal > 0 ? parseFloat((yrOccTotal / yrAvailTotal * 100).toFixed(2)) : 0;

  const yrArrivals = allMonths.reduce((sum, m) => {
    const md = m.residentsByDay[0] || {};
    return sum + (md.philippine_resident_filipino || 0) + (md.philippine_resident_foreign || 0) +
           (md.listed_foreign_resident || 0) + (md.unlisted_foreign_resident || 0) + 
           (md.unspecified_guest || 0) + (md.overseas_filipino || 0);
  }, 0);
  const yrNights = allMonths.reduce((sum, m) => sum + m.guestNights, 0);
  sheet.getCell(r.alos, lastCol).value = yrArrivals > 0 ? parseFloat((yrNights / yrArrivals).toFixed(2)) : 0;

  const setMonthlySexValues = (rowStart, gender) => {
    setMonthValues(rowStart + 1, m => mSex(m, gender, 'philippine_resident_filipino') + mSex(m, gender, 'philippine_resident_foreign'));
    setMonthValues(rowStart + 2, m => mSex(m, gender, 'listed_foreign_resident') + mSex(m, gender, 'unlisted_foreign_resident') + mSex(m, gender, 'unspecified_guest'));
    setMonthValues(rowStart + 3, m => mSex(m, gender, 'overseas_filipino'));
    setMonthValues(rowStart + 4, m => mSex(m, gender, 'unlisted_foreign_resident') + mSex(m, gender, 'unspecified_guest'));
    setMonthValues(rowStart + 5, m => {
      return mSex(m, gender, 'philippine_resident_filipino') +
             mSex(m, gender, 'philippine_resident_foreign') +
             mSex(m, gender, 'listed_foreign_resident') +
             mSex(m, gender, 'unlisted_foreign_resident') +
             mSex(m, gender, 'overseas_filipino') +
             mSex(m, gender, 'unspecified_guest');
    });
  };
  setMonthlySexValues(r.maleStart, 'male');
  setMonthlySexValues(r.femaleStart, 'female');
}

// ─── PDF Layout & Page-Break Config ─────────────────────────────────────────
const SHEET_PDF_CONFIG = {
  daily:   { layout: 'landscape', size: 'A3', margin: 45, breakRows: [64, 124] },
  monthly: { layout: 'landscape', size: 'A3', margin: 45, breakRows: [64, 124] },
  sum:     { layout: 'portrait',  size: 'A3', margin: 45, breakRows: [66, 128] },
};

function _getSheetPdfConfig(sheetName) {
  if (sheetName === 'AE DAE-1B by Country (Sum)') return SHEET_PDF_CONFIG.sum;
  if (sheetName.includes('Monthly'))              return SHEET_PDF_CONFIG.monthly;
  return SHEET_PDF_CONFIG.daily;
}

// ─── PDF Generation (returns Buffer instead of writing to file) ──────────────

async function _generatePdfBuffer(workbook, month, year) {
  const sheets = [];
  workbook.eachSheet(sheet => sheets.push(sheet));

  const firstConfig = sheets.length > 0
    ? _getSheetPdfConfig(sheets[0].name)
    : SHEET_PDF_CONFIG.daily;

  const doc = new PDFDocument({
    layout: firstConfig.layout,
    size:   firstConfig.size,
    margin: firstConfig.margin,
  });

  // Collect PDF output into a buffer
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const pdfPromise = new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const BASE_HEIGHT_FACTOR = 0.75;
  const BASE_WIDTH_FACTOR  = 5.25;
  const PAGE_DIMS = { A3: { w: 841.89, h: 1190.55 } };
  const _pageSize = name => PAGE_DIMS[name] || PAGE_DIMS.A3;

  let isFirstSheet = true;

  for (const sheet of sheets) {
    const cfg  = _getSheetPdfConfig(sheet.name);
    const ps   = _pageSize(cfg.size);
    const pgW  = cfg.layout === 'landscape' ? ps.h : ps.w;
    const pgH  = cfg.layout === 'landscape' ? ps.w : ps.h;
    const aw   = pgW - 2 * cfg.margin;
    const ah   = pgH - 2 * cfg.margin;

    if (!isFirstSheet) {
      doc.addPage({ layout: cfg.layout, size: cfg.size, margin: cfg.margin });
    }
    isFirstSheet = false;

    const rows = [];
    sheet.eachRow({ includeEmpty: true }, (row, rn) => {
      if (rn > 197) return;
      rows.push({ row, rn });
    });

    const breaks = [1, ...cfg.breakRows, Infinity];
    const sheetSections = [];
    for (let s = 0; s < breaks.length - 1; s++) {
      const lo = breaks[s];
      const hi = breaks[s + 1];
      const section = rows.filter(r => r.rn >= lo && r.rn < hi);
      if (section.length > 0) sheetSections.push(section);
    }

    let totalW = 0;
    for (let c = 1; c <= 33; c++) {
      const w = sheet.getColumn(c).width;
      if (w != null && w > 0) totalW += w;
    }
    if (totalW === 0) totalW = 40;

    let maxSectionH = 0;
    for (const sec of sheetSections) {
      let h = 0;
      for (const { row } of sec) h += row.height || 15;
      if (h > maxSectionH) maxSectionH = h;
    }
    if (maxSectionH === 0) maxSectionH = 300;
    const contentH = maxSectionH * (cfg.heightFactor ?? BASE_HEIGHT_FACTOR);

    const balancedWF = aw * contentH / (totalW * ah);
    const wf = Math.min(balancedWF, BASE_WIDTH_FACTOR);
    const contentW = totalW * wf;

    const scale = Math.min(aw / contentW, ah / contentH);
    const ox = (aw - contentW * scale) / 2;
    const oy = (ah - contentH * scale) / 2;
    const originX = cfg.margin + ox;
    const originY = cfg.margin + oy;

    for (let s = 0; s < sheetSections.length; s++) {
      const section = sheetSections[s];
      if (s > 0) {
        doc.addPage({ layout: cfg.layout, size: cfg.size, margin: cfg.margin });
      }

      let curY = originY;

      for (const { row, rn } of section) {
        const rh = (row.height || 15) * (cfg.heightFactor ?? BASE_HEIGHT_FACTOR) * scale;
        let curX = originX;

        row.eachCell({ includeEmpty: true }, (cell, cn) => {
          if (cn > 33) return;

          const cw = (sheet.getColumn(cn).width || 10) * wf * scale;

          if (cell.isMerged && cell.address !== cell.master.address) {
            curX += cw;
            return;
          }

          let bw = cw;
          let bh = rh;
          if (cell.isMerged) {
            const mr = _findMergeRange(sheet, cell.address);
            if (mr) {
              bw = 0;
              for (let c = mr.left; c <= mr.right; c++) bw += (sheet.getColumn(c).width || 10) * wf * scale;
              bh = 0;
              for (let r = mr.top; r <= mr.bottom; r++) bh += (sheet.getRow(r).height || 15) * BASE_HEIGHT_FACTOR * scale;
            }
          }

          if (cell.fill?.fgColor?.argb) {
            doc.rect(curX, curY, bw, bh)
               .fill('#' + cell.fill.fgColor.argb.substring(2));
          }

          if (cell.border) {
            doc.lineWidth(0.5).strokeColor('#000000');
            if (cell.border.top)    doc.moveTo(curX, curY).lineTo(curX + bw, curY).stroke();
            if (cell.border.bottom) doc.moveTo(curX, curY + bh).lineTo(curX + bw, curY + bh).stroke();
            if (cell.border.left)   doc.moveTo(curX, curY).lineTo(curX, curY + bh).stroke();
            if (cell.border.right)  doc.moveTo(curX + bw, curY).lineTo(curX + bw, curY + bh).stroke();
          }

          let text = '';
          if (cell.value?.richText) {
            text = cell.value.richText.map(rt => rt.text).join('');
          } else if (cell.value !== null && cell.value !== undefined) {
            if (typeof cell.value === 'object') {
              if (cell.value.result !== undefined && cell.value.result !== null) {
                text = cell.value.result.toString();
              } else if (cell.value.formula) {
                text = '';
              } else if (cell.value instanceof Date) {
                text = cell.value.toLocaleDateString();
              } else {
                text = cell.value.toString();
              }
            } else {
              text = cell.value.toString();
            }
          }

          if (text === '\u2714') {
            const cx = curX + bw / 2;
            const cy = curY + bh / 2;
            const s  = Math.min(bw, bh) * 0.35;
            const color = cell.font?.color?.argb
              ? '#' + cell.font.color.argb.substring(2)
              : '#000000';
            doc.fillColor(color)
               .lineWidth(Math.max(1, 1.5 * scale))
               .moveTo(cx - s * 0.5, cy - s * 0.05)
               .lineTo(cx - s * 0.1, cy + s * 0.4)
               .lineTo(cx + s * 0.6, cy - s * 0.3)
               .stroke();
          } else if (text) {
            const fontSize = ((cell.font?.size ?? 0) * 0.8 || 7) * scale;
            const isBold   = !!cell.font?.bold;
            const isItalic = !!cell.font?.italic;
            const color    = cell.font?.color?.argb
              ? '#' + cell.font.color.argb.substring(2)
              : '#000000';

            doc.fillColor(color)
               .font(isBold
                 ? (isItalic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold')
                 : (isItalic ? 'Helvetica-Oblique'     : 'Helvetica'))
               .fontSize(fontSize);

            const align    = cell.alignment?.horizontal || 'left';
            const pdfAlign = align === 'center'
              ? 'center'
              : (cn > 1 || align === 'right' ? 'right' : 'left');

            doc.text(text, curX + 2, curY + 2, {
              width:    bw - 4,
              height:   bh - 4,
              align:    pdfAlign,
              ellipsis: true,
            });
          }

          curX += cw;
        });
        curY += rh;
      }
    }
  }

  doc.end();
  return pdfPromise;
}

function _findMergeRange(sheet, address) {
  for (const merge of Object.values(sheet._merges || {})) {
    const masterAddress = sheet.getCell(merge.model.top, merge.model.left).address;
    if (address === masterAddress) return merge.model;
    const cell = sheet.getCell(address);
    if (cell.master?.address === masterAddress) return merge.model;
  }
  return null;
}

export default router;
