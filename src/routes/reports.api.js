import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const adminGuard = [auth.authenticate, auth.requireRole('admin')];

const UPLOADS_DIR = path.join(__dirname, '../../uploads/reports');
const TEMPLATE_PATH = path.join(__dirname, '../../sample/ON Blank Form.xlsx');

// ─── Country / Region Definitions ────────────────────────────────────────────
const kCountryRows = [
  { country: 'BRUNEI', row: 36 },
  { country: 'CAMBODIA', row: 37 },
  { country: 'INDONESIA', row: 38 },
  { country: 'LAOS', row: 39 },
  { country: 'MALAYSIA', row: 40 },
  { country: 'MYANMAR', row: 41 },
  { country: 'SINGAPORE', row: 42 },
  { country: 'THAILAND', row: 43 },
  { country: 'VIETNAM', row: 44 },
  { country: 'CHINA', row: 48 },
  { country: 'HONGKONG', row: 49 },
  { country: 'JAPAN', row: 50 },
  { country: 'KOREA', row: 51 },
  { country: 'TAIWAN', row: 52 },
  { country: 'BANGLADESH', row: 56 },
  { country: 'INDIA', row: 57 },
  { country: 'IRAN', row: 58 },
  { country: 'NEPAL', row: 59 },
  { country: 'PAKISTAN', row: 60 },
  { country: 'SRI LANKA', row: 61 },
  { country: 'BAHRAIN', row: 65 },
  { country: 'EGYPT', row: 66 },
  { country: 'ISRAEL', row: 67 },
  { country: 'JORDAN', row: 68 },
  { country: 'KUWAIT', row: 69 },
  { country: 'SAUDI ARABIA', row: 70 },
  { country: 'UNITED ARAB EMIRATES', row: 71 },
  { country: 'CANADA', row: 78 },
  { country: 'MEXICO', row: 79 },
  { country: 'USA', row: 80 },
  { country: 'ARGENTINA', row: 84 },
  { country: 'BRAZIL', row: 85 },
  { country: 'COLOMBIA', row: 86 },
  { country: 'PERU', row: 87 },
  { country: 'VENEZUELA', row: 88 },
  { country: 'AUSTRIA', row: 95 },
  { country: 'BELGIUM', row: 96 },
  { country: 'FRANCE', row: 97 },
  { country: 'GERMANY', row: 98 },
  { country: 'LUXEMBOURG', row: 99 },
  { country: 'NETHERLANDS', row: 100 },
  { country: 'SWITZERLAND', row: 101 },
  { country: 'DENMARK', row: 105 },
  { country: 'FINLAND', row: 106 },
  { country: 'IRELAND', row: 107 },
  { country: 'NORWAY', row: 108 },
  { country: 'SWEDEN', row: 109 },
  { country: 'UNITED KINGDOM', row: 110 },
  { country: 'GREECE', row: 114 },
  { country: 'ITALY', row: 115 },
  { country: 'PORTUGAL', row: 116 },
  { country: 'SPAIN', row: 117 },
  { country: 'UNION OF SERBIA AND MONTENEGRO', row: 118 },
  { country: 'COMMONWEALTH OF INDEPENDENT STATES', row: 122 },
  { country: 'POLAND', row: 123 },
  { country: 'RUSSIA', row: 124 },
  { country: 'AUSTRALIA', row: 131 },
  { country: 'GUAM', row: 132 },
  { country: 'NAURU', row: 133 },
  { country: 'NEW ZEALAND', row: 134 },
  { country: 'PAPUA NEW GUINEA', row: 135 },
  { country: 'NIGERIA', row: 142 },
  { country: 'SOUTH AFRICA', row: 143 },
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

// ─── FIX: "Other Countries" catch-all row ────────────────────────────────────
// Foreign nationals whose country is NOT listed in kCountryRows are accumulated
// here instead of being silently dropped.
// ⚠️  VERIFY this row number matches the "Others" / "Other Countries" row in
//     your actual "ON Blank Form.xlsx" template before deploying.
const kOtherCountriesRow = 144;

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
  if (c === '' || c === 'UNKNOWN') return 'unspecified_guest';
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

// ─── FIX: Purge named ranges orphaned by template-sheet deletion ─────────────
// ExcelJS carries named ranges (print areas, _xlnm.Print_Area, user-defined
// names) from the template into the workbook model.  After removeWorksheet(),
// those ranges still reference the deleted sheets — Excel detects them on open
// and shows the "Removed Records: Named range" recovery dialog.
// Solution: filter the model down to ranges whose sheet still exists.
function _purgeOrphanedDefinedNames(workbook) {
  try {
    const validSheets = new Set(workbook.worksheets.map(ws => ws.name));

    // Clean workbook-level defined names
    const dm = workbook.definedNames || workbook._definedNames;
    if (dm && Array.isArray(dm.model)) {
      dm.model = dm.model.filter(dn => {
        const ranges = [].concat(dn.ranges ?? dn.range ?? []);
        if (!ranges.length) return false;
        return ranges.every(r => {
          // If the range contains #REF!, it's definitely orphaned.
          if (String(r).includes('#REF!')) return false;
          // Handles both  'Sheet Name'!$A$1  and  SheetName!$A$1
          const m = String(r).match(/^'([^']+)'!|^([^'!][^!]*)!/);
          const sheetName = m ? (m[1] ?? m[2]) : null;
          return sheetName && validSheets.has(sheetName);
        });
      });
    }
  } catch (err) {
    console.warn('[report] Named-range cleanup skipped:', err.message);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/reports', adminGuard, async (req, res, next) => {
  try {
    const [rows] = await db.pool.execute(
      'SELECT r.*, u.full_name as generated_by_name FROM reports r LEFT JOIN users u ON r.generated_by = u.id ORDER BY r.generated_at DESC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/reports/generate', adminGuard, async (req, res, next) => {
  try {
    const { month, year, sheetOptions } = req.body;

    const [existing] = await db.pool.execute(
      'SELECT id FROM reports WHERE report_type = "DAE-1B" AND period_month = ? AND period_year = ? LIMIT 1',
      [month, year]
    );
    if (existing.length > 0) {
      return res.status(400).json({
        message: `A DAE-1B report for ${kMonthNames[month]} ${year} already exists.`
      });
    }

    const [businesses] = await db.pool.execute(
      `SELECT id, business_name, business_line, region, city_municipality, province, total_rooms,
              owner_first_name, owner_last_name, owner_middle_name
       FROM businesses WHERE status = 'approved' AND deleted_at IS NULL ORDER BY business_name`
    );

    if (businesses.length === 0) {
      return res.status(400).json({ message: 'No approved businesses found.' });
    }

    const [userRows] = await db.pool.execute('SELECT full_name, role FROM users WHERE id = ?', [req.user.id]);
    const adminName = userRows[0]?.full_name || 'System Admin';
    const adminRole = userRows[0]?.role || 'Admin';

    const selectedMonthPerBiz = await Promise.all(
      businesses.map(b => _fetchMonthData(b.id, month, year))
    );

    let allTwelveMonthsMerged = null;
    if (sheetOptions.includeMonthlySummarySheet) {
      allTwelveMonthsMerged = [];
      for (let m = 1; m <= 12; m++) {
        const perBiz = await Promise.all(
          businesses.map(b => _fetchMonthData(b.id, m, year, true))
        );
        allTwelveMonthsMerged.push(_mergeMonthData(m, perBiz));
      }
    }

    const totalRoomsAll = businesses.reduce((sum, b) => sum + (b.total_rooms || 0), 0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(TEMPLATE_PATH);

    const templateSheet        = workbook.getWorksheet('Name of Establishment');
    const summarySheetTemplate = workbook.getWorksheet('AE DAE-1B by Country (Sum) ');
    const monthlySheetTemplate = workbook.getWorksheet('AE DAE-1B (Monthly)');

    if (!templateSheet || !summarySheetTemplate || !monthlySheetTemplate) {
      throw new Error('Template worksheets not found. Check sheet names in template file.');
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstBiz = businesses[0];
    const city = firstBiz?.city_municipality || '';
    const province = firstBiz?.province || '';

    if (sheetOptions.includeDailySheet) {
      for (let i = 0; i < businesses.length; i++) {
        const bizName = businesses[i].business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
        const sheet = workbook.addWorksheet(bizName);
        _copySheetProperties(templateSheet, sheet);
        _buildDailySheet(sheet, businesses[i], selectedMonthPerBiz[i], month, year, daysInMonth, adminName);
      }
    }

    const mergedSelectedMonth = _mergeMonthData(month, selectedMonthPerBiz);

    if (sheetOptions.includeCountrySumSheet) {
      const sheet = workbook.addWorksheet('AE DAE-1B by Country (Sum)');
      _copySheetProperties(summarySheetTemplate, sheet);
      _buildCountrySummarySheet(sheet, mergedSelectedMonth, totalRoomsAll, month, year, daysInMonth, adminName, city, province);
    }

    if (sheetOptions.includeMonthlySummarySheet && allTwelveMonthsMerged) {
      const sheet = workbook.addWorksheet('AE DAE-1B (Monthly) Summary');
      _copySheetProperties(monthlySheetTemplate, sheet);
      _buildMonthlySummarySheet(sheet, allTwelveMonthsMerged, totalRoomsAll, year, adminName, city, province);
    }

    // ── FIX: Clear print areas from template sheets before removing them.
    //    Sometimes ExcelJS persists the global _xlnm.Print_Area link even
    //    if the sheet is removed from the workbook.
    [templateSheet, summarySheetTemplate, monthlySheetTemplate].forEach(ws => {
      if (ws.pageSetup) ws.pageSetup.printArea = null;
    });

    // Remove template sheets from the output workbook
    workbook.removeWorksheet(templateSheet.id);
    workbook.removeWorksheet(summarySheetTemplate.id);
    workbook.removeWorksheet(monthlySheetTemplate.id);

    // ── FIX: Remove named ranges that now point at the deleted template sheets.
    //    Without this Excel shows a "Removed Records: Named range" recovery dialog.
    _purgeOrphanedDefinedNames(workbook);

    const reportId    = uuidv4();
    const timestamp   = Date.now();
    const excelFileName = `DAE1B_ALL_${year}_${String(month).padStart(2, '0')}_${timestamp}.xlsx`;
    const excelPath   = path.join(UPLOADS_DIR, excelFileName);

    await workbook.xlsx.writeFile(excelPath);

    const pdfFileName = excelFileName.replace('.xlsx', '.pdf');
    const pdfPath     = path.join(UPLOADS_DIR, pdfFileName);
    await _generatePdfFromWorkbook(workbook, pdfPath, month, year);

    await _archiveMonthRecords(month, year);

    const fileUrl = `/uploads/reports/${excelFileName}`;
    await db.pool.execute(
      `INSERT INTO reports (id, report_type, period_month, period_year, file_url, generated_by,
        include_sheet_establishment, include_sheet_country_sum, include_sheet_monthly)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reportId, 'DAE-1B', month, year, fileUrl, req.user.id,
        sheetOptions.includeDailySheet, sheetOptions.includeCountrySumSheet, sheetOptions.includeMonthlySummarySheet
      ]
    );

    res.json({ message: 'Report generated successfully', fileUrl });
  } catch (err) {
    console.error('Report Generation Error:', err);
    next(err);
  }
});

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
      
      // ── FIX: "Unshare" shared formulas ─────────────────────────────────────
      // If the template uses shared formulas (e.g. AG29:AG30), ExcelJS might
      // fail with "Shared Formula master must exist..." if we later overwrite
      // the master cell (AG29) with a hard-coded value but leave the clone 
      // (AG30) as-is.  Converting them to regular formulas during copy avoids
      // this dependency.
      if (cell.type === ExcelJS.ValueType.Formula) {
        dstCell.value = {
          formula: cell.formula,
          result:  cell.result
        };
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

// ─── Data Fetching ───────────────────────────────────────────────────────────

async function _fetchMonthData(businessId, month, year, includeArchived = false) {
  const firstDay    = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay     = new Date(year, month, 0).toISOString().split('T')[0];
  const statusFilter = includeArchived
    ? "AND status IN ('active', 'archived')"
    : "AND status = 'active'";

  const [records] = await db.pool.execute(
    `SELECT id, check_in, check_out, rooms_occupied
     FROM guest_records
     WHERE business_id = ? AND is_deleted = false
       AND check_in >= ? AND check_in <= ? ${statusFilter}`,
    [businessId, firstDay, lastDay]
  );

  const recordIds = records.map(r => r.id);
  let breakdowns  = [];
  if (recordIds.length > 0) {
    const [bdRows] = await db.pool.execute(
      `SELECT guest_record_id, country, sex, nationality, count, is_overseas
       FROM guest_breakdowns WHERE guest_record_id IN (${recordIds.map(() => '?').join(',')})`,
      recordIds
    );
    breakdowns = bdRows;
  }

  // Total guest count per record (used for guestNights calculation)
  const recordGuestCount = {};
  breakdowns.forEach(b => {
    recordGuestCount[b.guest_record_id] = (recordGuestCount[b.guest_record_id] || 0) + _asInt(b.count);
  });

  // Precompute check-in day in LOCAL time so the day number is never off-by-one
  // in Philippine timezone (UTC+8).
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

  // ── Night / room calculations (requires both check-in AND check-out) ────────
  records.forEach(r => {
    const checkIn = _parseLocalDate(r.check_in);
    if (!checkIn) return;

    // Guests with no check-out are still counted as arrivals (via breakdowns
    // below) but cannot contribute to guest-nights or rooms-occupied.
    if (!r.check_out) return;

    const checkOut  = _parseLocalDate(r.check_out);
    const nights    = Math.max(0, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
    const rooms     = r.rooms_occupied || 0;
    const guestCount = recordGuestCount[r.id] || 0;
    const day       = checkIn.getDate();

    if (nights > 0) {
      totalGuestNights += nights * guestCount;
      guestNightsPerArrivalDay[day] = (guestNightsPerArrivalDay[day] || 0) + (nights * guestCount);

      // Spread rooms-occupied and guest-nights across each stay-night
      for (let n = 0; n < nights; n++) {
        const stayDate = new Date(checkIn);
        stayDate.setDate(checkIn.getDate() + n);
        if (stayDate.getFullYear() === year && (stayDate.getMonth() + 1) === month) {
          const stayDay = stayDate.getDate();
          roomsOccupiedByDay[stayDay] = (roomsOccupiedByDay[stayDay] || 0) + rooms;
          guestNightsByDay[stayDay]   = (guestNightsByDay[stayDay]   || 0) + guestCount;
        }
      }
    }
  });

  // ── Arrival / residency / country tallies (all records with a valid day) ────
  breakdowns.forEach(b => {
    const day = recordDay[b.guest_record_id];
    if (!day) return;

    const country     = (b.country || '').toUpperCase();
    const nationality = (b.nationality || '');
    const sex         = (b.sex || '').toLowerCase();
    const bucket      = _classifyResidenceBucket({ country, nationality, isOverseas: !!b.is_overseas });
    const count       = _asInt(b.count);

    // All foreign residents go into countryByDay (listed and unlisted countries).
    // _otherCountriesTotal() later computes the unlisted subset for display.
    if (bucket === 'foreign_resident' && country) {
      if (!countryByDay[country]) countryByDay[country] = { 0: 0 };
      countryByDay[country][day] = (countryByDay[country][day] || 0) + count;
      countryByDay[country][0]   = (countryByDay[country][0]   || 0) + count;
    }

    // Residency bucket totals (day-level and grand total at key 0)
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

async function _archiveMonthRecords(month, year) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay  = new Date(year, month, 0).toISOString().split('T')[0];
  const [records] = await db.pool.execute(
    `SELECT id FROM guest_records WHERE status = 'active' AND is_deleted = false
     AND check_in >= ? AND check_in <= ?`,
    [firstDay, lastDay]
  );
  const ids = records.map(r => r.id);
  if (ids.length > 0) {
    await db.pool.execute(
      `UPDATE guest_records SET status = 'archived' WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }
}

// ─── Excel Builders ──────────────────────────────────────────────────────────

function _buildDailySheet(sheet, biz, md, month, year, daysInMonth, adminName) {
  // ── Header cells ────────────────────────────────────────────────────────────
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
      sheet.getCell(`B${t.row}`).value     = '✔';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  sheet.getCell('A22').value = `City/Municipality: ${biz.city_municipality || ''}`;
  sheet.getCell('A23').value = `Province: ${biz.province || ''}`;

  // ── Day-column writer ────────────────────────────────────────────────────────
  // Days within the month get the real value (0 is written as 0, not blank).
  // Days beyond the month end (e.g. day 31 in a 30-day month) are left null.
  const setDayValues = (rowNum, fn) => {
    for (let d = 1; d <= 31; d++) {
      sheet.getCell(rowNum, d + 1).value = d > daysInMonth ? null : (fn(d) ?? 0);
    }
  };

  const res = (d, cat)     => md.residentsByDay[d]?.[cat] || 0;
  const cnt = (country, d) => md.countryByDay[country.toUpperCase()]?.[d] || 0;
  const sex = (d, s, cat)  => md.sexByDay[d]?.[s]?.[cat] || 0;

  // ── Residency rows ───────────────────────────────────────────────────────────
  setDayValues(28, d => res(d, 'philippine_resident_filipino'));
  setDayValues(29, d => res(d, 'philippine_resident_foreign'));
  
  // TOTAL PHILIPPINE RESIDENTS
  setDayValues(30, d => res(d, 'philippine_resident_filipino') + res(d, 'philippine_resident_foreign'));

  kCountryRows.forEach(c => setDayValues(c.row, d => cnt(c.country, d)));

  // FIX: write catch-all "Other Countries" row so unlisted foreign nationals
  // are not silently dropped from the sheet.
  setDayValues(kOtherCountriesRow, d => _otherCountriesTotal(md.countryByDay, d));

  // TOTAL FOREIGN RESIDENTS
  setDayValues(145, d => res(d, 'foreign_resident'));

  setDayValues(148, d => res(d, 'unspecified_guest'));
  setDayValues(151, d => res(d, 'overseas_filipino'));

  // GRAND TOTAL
  setDayValues(152, d => {
    return res(d, 'philippine_resident_filipino') +
           res(d, 'philippine_resident_foreign') +
           res(d, 'foreign_resident') +
           res(d, 'unspecified_guest') +
           res(d, 'overseas_filipino');
  });

  // ── Rooms & guest-nights ────────────────────────────────────────────────────
  setDayValues(160, d => md.roomsOccupied[d] || 0);
  setDayValues(161, () => biz.total_rooms);
  setDayValues(162, d => md.guestNightsByDay[d] || 0);

  // ── Computed metrics ─────────────────────────────────────────────────────────
  // Occupancy rate = rooms used / total rooms × 100  (stored as a real number)
  setDayValues(165, d => {
    if (!biz.total_rooms) return 0;
    return parseFloat(((md.roomsOccupied[d] || 0) / biz.total_rooms * 100).toFixed(2));
  });
  // ALOS for arrivals on day d = total guest-nights generated by those arrivals
  // divided by the number of guests who checked in on day d.
  setDayValues(166, d => {
    const arrivals = Object.values(md.residentsByDay[d] || {}).reduce((a, b) => a + b, 0);
    if (!arrivals) return 0;
    return parseFloat(((md.guestNightsPerArrivalDay[d] || 0) / arrivals).toFixed(2));
  });

  // ── Sex breakdown ────────────────────────────────────────────────────────────
  const setSexValues = (rowStart, gender) => {
    setDayValues(rowStart + 1, d => sex(d, gender, 'philippine_resident_filipino') + sex(d, gender, 'philippine_resident_foreign'));
    setDayValues(rowStart + 2, d => sex(d, gender, 'foreign_resident'));
    setDayValues(rowStart + 3, d => sex(d, gender, 'overseas_filipino'));
    setDayValues(rowStart + 4, d => sex(d, gender, 'unspecified_guest'));
  };
  setSexValues(170, 'male');
  setSexValues(177, 'female');

  // ── FIX: Total column (AG = kTotalCol) ─────────────────────────────────────
  // Writes the month grand-total to column AG for every data row.
  // If the template already has SUM formulas there, this overwrites them with
  // equivalent hard-coded numbers (more reliable — no formula recalculation risk).
  const writeTotal = (rowNum, value) => {
    sheet.getCell(rowNum, kTotalCol).value = value ?? 0;
  };

  const phTotal = (md.residentsByDay[0]?.['philippine_resident_filipino'] ?? 0) + 
                  (md.residentsByDay[0]?.['philippine_resident_foreign'] ?? 0);
  const foreignTotal = md.residentsByDay[0]?.['foreign_resident'] ?? 0;
  const grandTotalAll = phTotal + foreignTotal + 
                        (md.residentsByDay[0]?.['unspecified_guest'] ?? 0) + 
                        (md.residentsByDay[0]?.['overseas_filipino'] ?? 0);

  // Residency totals
  writeTotal(28, md.residentsByDay[0]?.['philippine_resident_filipino'] ?? 0);
  writeTotal(29, md.residentsByDay[0]?.['philippine_resident_foreign'] ?? 0);
  writeTotal(30, phTotal);

  kCountryRows.forEach(c =>
    writeTotal(c.row, md.countryByDay[c.country]?.[0] ?? 0)
  );
  writeTotal(kOtherCountriesRow, _otherCountriesTotal(md.countryByDay, 0));
  writeTotal(145, foreignTotal);

  writeTotal(148, md.residentsByDay[0]?.['unspecified_guest'] ?? 0);
  writeTotal(151, md.residentsByDay[0]?.['overseas_filipino'] ?? 0);
  writeTotal(152, grandTotalAll);

  // Rooms & nights totals
  const totalRoomsOccAll = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalRoomsAvail  = (biz.total_rooms || 0) * daysInMonth;
  writeTotal(160, totalRoomsOccAll);
  writeTotal(161, totalRoomsAvail);
  writeTotal(162, md.guestNights);

  // Occupancy rate for the full month
  writeTotal(165, totalRoomsAvail > 0
    ? parseFloat((totalRoomsOccAll / totalRoomsAvail * 100).toFixed(2))
    : 0
  );
  // ALOS for the full month = total guest-nights / total arrivals
  const grandTotalArrivals = Object.values(md.residentsByDay[0] ?? {}).reduce((a, b) => a + b, 0);
  writeTotal(166, grandTotalArrivals > 0
    ? parseFloat((md.guestNights / grandTotalArrivals).toFixed(2))
    : 0
  );

  // Sex breakdown totals
  writeTotal(171, sex(0, 'male', 'philippine_resident_filipino') + sex(0, 'male', 'philippine_resident_foreign'));
  writeTotal(172, sex(0, 'male', 'foreign_resident'));
  writeTotal(173, sex(0, 'male', 'overseas_filipino'));
  writeTotal(174, sex(0, 'male', 'unspecified_guest'));

  writeTotal(178, sex(0, 'female', 'philippine_resident_filipino') + sex(0, 'female', 'philippine_resident_foreign'));
  writeTotal(179, sex(0, 'female', 'foreign_resident'));
  writeTotal(180, sex(0, 'female', 'overseas_filipino'));
  writeTotal(181, sex(0, 'female', 'unspecified_guest'));

  // ── Footer ──────────────────────────────────────────────────────────────────
  const ownerName = [biz.owner_first_name, biz.owner_middle_name, biz.owner_last_name].filter(Boolean).join(' ') || '______________________';
  
  sheet.getCell('A185').value = 'Prepared by:';
  sheet.getCell('A186').value = ownerName.toUpperCase();
  sheet.getCell('A187').value = 'Owner / Manager';

  sheet.getCell('A189').value = 'Certified Correct by:';
  sheet.getCell('A190').value = adminName.toUpperCase();
  sheet.getCell('A191').value = 'Tourism Officer';

  sheet.getCell('AF188').value = `Date Submitted: ${new Date().toLocaleDateString()}`;
}

function _buildCountrySummarySheet(sheet, md, totalRoomsAll, month, year, daysInMonth, adminName, city, province) {
  sheet.getCell('B3').value = 'Region: __4-A';
  sheet.getCell('A4').value = 'All Accommodation Establishments — Combined';
  sheet.getCell('A5').value = `${kMonthNames[month]}, ${year}`;

  sheet.getCell('A22').value = `City/Municipality: ${city || ''}`;
  sheet.getCell('A23').value = `Province: ${province || ''}`;

  const res = cat     => md.residentsByDay[0]?.[cat] || 0;
  const cnt = country => md.countryByDay[country.toUpperCase()]?.[0] || 0;
  const sex = (s, cat) => md.sexByDay[0]?.[s]?.[cat] || 0;

  // ── Residency rows (column B = grand total for the month) ────────────────────
  sheet.getCell('B28').value = res('philippine_resident_filipino');
  sheet.getCell('B29').value = res('philippine_resident_foreign');
  
  // TOTAL PHILIPPINE RESIDENTS
  sheet.getCell('B30').value = res('philippine_resident_filipino') + res('philippine_resident_foreign');

  kCountryRows.forEach(c => { sheet.getCell(`B${c.row}`).value = cnt(c.country); });

  // FIX: write catch-all "Other Countries" total
  sheet.getCell(`B${kOtherCountriesRow}`).value = _otherCountriesTotal(md.countryByDay, 0);

  // TOTAL FOREIGN RESIDENTS
  sheet.getCell('B145').value = res('foreign_resident');

  sheet.getCell('B148').value = res('unspecified_guest');
  sheet.getCell('B151').value = res('overseas_filipino');

  // GRAND TOTAL
  const grandTotal =
    res('philippine_resident_filipino') +
    res('philippine_resident_foreign') +
    res('foreign_resident') +
    res('unspecified_guest') +
    res('overseas_filipino');
  sheet.getCell('B152').value = grandTotal;

  // ── Rooms & nights ──────────────────────────────────────────────────────────
  const totalRoomsOcc  = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalAvailRoom = totalRoomsAll * daysInMonth;
  sheet.getCell('B160').value = totalRoomsOcc;
  sheet.getCell('B161').value = totalAvailRoom;
  sheet.getCell('B162').value = md.guestNights;

  // ── Computed metrics ─────────────────────────────────────────────────────────
  sheet.getCell('B165').value = totalAvailRoom > 0
    ? parseFloat((totalRoomsOcc / totalAvailRoom * 100).toFixed(2))
    : 0;
  sheet.getCell('B166').value = grandTotal > 0
    ? parseFloat((md.guestNights / grandTotal).toFixed(2))
    : 0;

  // ── Sex breakdown ────────────────────────────────────────────────────────────
  const setSexValues = (rowStart, gender) => {
    sheet.getCell(`B${rowStart + 1}`).value = sex(gender, 'philippine_resident_filipino') + sex(gender, 'philippine_resident_foreign');
    sheet.getCell(`B${rowStart + 2}`).value = sex(gender, 'foreign_resident');
    sheet.getCell(`B${rowStart + 3}`).value = sex(gender, 'overseas_filipino');
    sheet.getCell(`B${rowStart + 4}`).value = sex(gender, 'unspecified_guest');
  };
  setSexValues(170, 'male');
  setSexValues(177, 'female');

  // ── Footer ──────────────────────────────────────────────────────────────────
  sheet.getCell('A189').value = 'Certified Correct by:';
  sheet.getCell('A190').value = adminName.toUpperCase();
  sheet.getCell('A191').value = 'Tourism Officer';

  sheet.getCell('AF188').value = `Date Submitted: ${new Date().toLocaleDateString()}`;
}

function _buildMonthlySummarySheet(sheet, allMonths, totalRoomsAll, year, adminName, city, province) {
  sheet.getCell('B3').value = 'Region: __4-A';
  sheet.getCell('A4').value = 'All Accommodation Establishments — Combined';
  sheet.getCell('A5').value = `${year}`;

  sheet.getCell('A22').value = `City/Municipality: ${city || ''}`;
  sheet.getCell('A23').value = `Province: ${province || ''}`;

  // Sets values for months 1-12 into columns B-M (col index 2-13).
  const setMonthValues = (rowNum, fn) => {
    for (let m = 1; m <= 12; m++) {
      sheet.getCell(rowNum, m + 1).value = fn(m) ?? 0;
    }
  };

  const mdFor = m => allMonths.find(x => x.month === m) || {
    countryByDay: {}, residentsByDay: { 0: {} },
    sexByDay: { 0: { male: {}, female: {} } },
    roomsOccupied: {}, guestNights: 0,
  };
  const mRes = (m, cat)     => mdFor(m).residentsByDay[0]?.[cat] || 0;
  const mCnt = (country, m) => mdFor(m).countryByDay[country.toUpperCase()]?.[0] || 0;
  const mSex = (m, s, cat)  => mdFor(m).sexByDay[0]?.[s]?.[cat] || 0;

  // ── Residency rows ───────────────────────────────────────────────────────────
  setMonthValues(28, m => mRes(m, 'philippine_resident_filipino'));
  setMonthValues(29, m => mRes(m, 'philippine_resident_foreign'));
  
  // TOTAL PHILIPPINE RESIDENTS
  setMonthValues(30, m => mRes(m, 'philippine_resident_filipino') + mRes(m, 'philippine_resident_foreign'));

  kCountryRows.forEach(c => setMonthValues(c.row, m => mCnt(c.country, m)));

  // FIX: write "Other Countries" row for monthly sheet
  setMonthValues(kOtherCountriesRow, m => _otherCountriesTotal(mdFor(m).countryByDay, 0));

  // TOTAL FOREIGN RESIDENTS
  setMonthValues(145, m => mRes(m, 'foreign_resident'));

  setMonthValues(148, m => mRes(m, 'unspecified_guest'));
  setMonthValues(151, m => mRes(m, 'overseas_filipino'));

  // GRAND TOTAL
  setMonthValues(152, m => {
    return mRes(m, 'philippine_resident_filipino') +
           mRes(m, 'philippine_resident_foreign') +
           mRes(m, 'foreign_resident') +
           mRes(m, 'unspecified_guest') +
           mRes(m, 'overseas_filipino');
  });

  // ── Rooms & nights ──────────────────────────────────────────────────────────
  setMonthValues(160, m => Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0));
  setMonthValues(161, m => totalRoomsAll * new Date(year, m, 0).getDate());
  setMonthValues(162, m => mdFor(m).guestNights);

  // ── Computed metrics ─────────────────────────────────────────────────────────
  setMonthValues(165, m => {
    const daysInM    = new Date(year, m, 0).getDate();
    const totalAvail = totalRoomsAll * daysInM;
    const totalOcc   = Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0);
    return totalAvail > 0
      ? parseFloat((totalOcc / totalAvail * 100).toFixed(2))
      : 0;
  });
  setMonthValues(166, m => {
    const monthMd    = mdFor(m);
    const grandTotal =
      mRes(m, 'philippine_resident_filipino') +
      mRes(m, 'philippine_resident_foreign') +
      mRes(m, 'foreign_resident') +    // ← covers all countries (listed + unlisted)
      mRes(m, 'unspecified_guest') +
      mRes(m, 'overseas_filipino');
    return grandTotal > 0
      ? parseFloat((monthMd.guestNights / grandTotal).toFixed(2))
      : 0;
  });

  // ── Sex breakdown ────────────────────────────────────────────────────────────
  const setMonthlySexValues = (rowStart, gender) => {
    setMonthValues(rowStart + 1, m => mSex(m, gender, 'philippine_resident_filipino') + mSex(m, gender, 'philippine_resident_foreign'));
    setMonthValues(rowStart + 2, m => mSex(m, gender, 'foreign_resident'));
    setMonthValues(rowStart + 3, m => mSex(m, gender, 'overseas_filipino'));
    setMonthValues(rowStart + 4, m => mSex(m, gender, 'unspecified_guest'));
  };
  setMonthlySexValues(170, 'male');
  setMonthlySexValues(177, 'female');

  // ── Footer ──────────────────────────────────────────────────────────────────
  sheet.getCell('A189').value = 'Certified Correct by:';
  sheet.getCell('A190').value = adminName.toUpperCase();
  sheet.getCell('A191').value = 'Tourism Officer';

  sheet.getCell('AF188').value = `Date Submitted: ${new Date().toLocaleDateString()}`;
}

// ─── PDF Generation ──────────────────────────────────────────────────────────

async function _generatePdfFromWorkbook(workbook, pdfPath, month, year) {
  const doc    = new PDFDocument({ layout: 'landscape', size: 'A3', margin: 20 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  workbook.eachSheet((sheet, sheetIdx) => {
    if (sheetIdx > 1) doc.addPage();

    const pointsPerExcelHeight = 0.75;
    const pointsPerExcelWidth  = 5.25;

    let currentY = 20;

    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > 197) return;

      const rowHeight = (row.height || 15) * pointsPerExcelHeight;
      let currentX = 20;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > 33) return;

        const colWidth = (sheet.getColumn(colNumber).width || 10) * pointsPerExcelWidth;

        if (cell.isMerged && cell.address !== cell.master.address) {
          currentX += colWidth;
          return;
        }

        let boxWidth  = colWidth;
        let boxHeight = rowHeight;
        if (cell.isMerged) {
          const mergeRange = _findMergeRange(sheet, cell.address);
          if (mergeRange) {
            boxWidth  = 0;
            for (let c = mergeRange.left; c <= mergeRange.right; c++) {
              boxWidth += (sheet.getColumn(c).width || 10) * pointsPerExcelWidth;
            }
            boxHeight = 0;
            for (let r = mergeRange.top; r <= mergeRange.bottom; r++) {
              boxHeight += (sheet.getRow(r).height || 15) * pointsPerExcelHeight;
            }
          }
        }

        if (cell.fill?.fgColor?.argb) {
          doc.rect(currentX, currentY, boxWidth, boxHeight)
             .fill('#' + cell.fill.fgColor.argb.substring(2));
        }

        if (cell.border) {
          doc.lineWidth(0.5).strokeColor('#000000');
          if (cell.border.top)    doc.moveTo(currentX, currentY).lineTo(currentX + boxWidth, currentY).stroke();
          if (cell.border.bottom) doc.moveTo(currentX, currentY + boxHeight).lineTo(currentX + boxWidth, currentY + boxHeight).stroke();
          if (cell.border.left)   doc.moveTo(currentX, currentY).lineTo(currentX, currentY + boxHeight).stroke();
          if (cell.border.right)  doc.moveTo(currentX + boxWidth, currentY).lineTo(currentX + boxWidth, currentY + boxHeight).stroke();
        }

        let text = '';
        if (cell.value?.richText) {
          text = cell.value.richText.map(rt => rt.text).join('');
        } else if (cell.value?.result !== undefined) {
          text = cell.value.result.toString();
        } else if (cell.value !== null && cell.value !== undefined) {
          text = cell.value.toString();
        }

        if (text) {
          const fontSize = (cell.font?.size ?? 0) * 0.8 || 7;
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

          const align = cell.alignment?.horizontal || 'left';
          doc.text(text, currentX + 2, currentY + 2, {
            width:   boxWidth  - 4,
            height:  boxHeight - 4,
            align:   align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left'),
            ellipsis: true,
          });
        }

        currentX += colWidth;
      });
      currentY += rowHeight;
    });
  });

  doc.end();
  return new Promise(resolve => stream.on('finish', resolve));
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