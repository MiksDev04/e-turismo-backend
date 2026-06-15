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
// Row numbers based on inspection of "ON Blank Form.xlsx"
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _classifyResidenceBucket({ country, nationality, isOverseas }) {
  const c = (country || '').toUpperCase();
  const n = (nationality || '').toLowerCase();
  const iso = !!isOverseas;

  if (iso) return 'overseas_filipino';
  if (c === 'PHILIPPINES' || n === 'filipino') {
    if (n === 'filipino') return 'philippine_resident_filipino';
    return 'philippine_resident_foreign';
  }
  if (c === '' || c === 'UNKNOWN') return 'unspecified_guest';
  return 'foreign_resident';
}

function _asInt(v) {
  return parseInt(v, 10) || 0;
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
      `SELECT id, business_name, business_line, region, city_municipality, province, total_rooms
       FROM businesses WHERE status = 'approved' AND deleted_at IS NULL ORDER BY business_name`
    );

    if (businesses.length === 0) {
      return res.status(400).json({ message: 'No approved businesses found.' });
    }

    const [userRows] = await db.pool.execute('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
    const adminName = userRows[0]?.full_name || 'System Admin';

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

    // Retrieve sheets by exact name from template
    const templateSheet = workbook.getWorksheet('Name of Establishment');
    const summarySheetTemplate = workbook.getWorksheet('AE DAE-1B by Country (Sum) ');
    const monthlySheetTemplate = workbook.getWorksheet('AE DAE-1B (Monthly)');

    if (!templateSheet || !summarySheetTemplate || !monthlySheetTemplate) {
       throw new Error('Template worksheets not found. Check sheet names in template file.');
    }

    const daysInMonth = new Date(year, month, 0).getDate();


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
      _buildCountrySummarySheet(sheet, mergedSelectedMonth, totalRoomsAll, month, year, daysInMonth, adminName);
    }

    if (sheetOptions.includeMonthlySummarySheet && allTwelveMonthsMerged) {
      const sheet = workbook.addWorksheet('AE DAE-1B (Monthly) Summary');
      _copySheetProperties(monthlySheetTemplate, sheet);
      _buildMonthlySummarySheet(sheet, allTwelveMonthsMerged, totalRoomsAll, year, adminName);
    }

    // Delete original templates before saving
    workbook.removeWorksheet(templateSheet.id);
    workbook.removeWorksheet(summarySheetTemplate.id);
    workbook.removeWorksheet(monthlySheetTemplate.id);

    const reportId = uuidv4();
    const timestamp = Date.now();
    const excelFileName = `DAE1B_ALL_${year}_${String(month).padStart(2, '0')}_${timestamp}.xlsx`;
    const excelPath = path.join(UPLOADS_DIR, excelFileName);
    
    await workbook.xlsx.writeFile(excelPath);

    const pdfFileName = excelFileName.replace('.xlsx', '.pdf');
    const pdfPath = path.join(UPLOADS_DIR, pdfFileName);
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

function _copySheetProperties(src, dst) {
  if (src.properties) dst.properties = JSON.parse(JSON.stringify(src.properties));
  if (src.pageSetup) dst.pageSetup = JSON.parse(JSON.stringify(src.pageSetup));
  if (src.views) dst.views = JSON.parse(JSON.stringify(src.views));
  
  // Set columns (widths)
  if (src.columns) {
    dst.columns = src.columns.map(c => ({
      width: c.width,
      header: c.header,
      key: c.key,
      style: c.style ? JSON.parse(JSON.stringify(c.style)) : undefined
    }));
  }
  
  // Copy rows and cells with styles
  src.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const dstRow = dst.getRow(rowNumber);
    dstRow.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const dstCell = dstRow.getCell(colNumber);
      dstCell.value = cell.value;
      if (cell.style) dstCell.style = JSON.parse(JSON.stringify(cell.style));
    });
  });
  
  // Copy merges
  if (src._merges) {
    Object.values(src._merges).forEach(m => {
       try {
          dst.mergeCells(m.model.top, m.model.left, m.model.bottom, m.model.right);
       } catch (e) {
          // Ignore overlapping merge errors if any
       }
    });
  }
}


async function _fetchMonthData(businessId, month, year, includeArchived = false) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
  let statusFilter = includeArchived ? "AND status IN ('active', 'archived')" : "AND status = 'active'";

  const [records] = await db.pool.execute(`SELECT id, check_in, check_out, rooms_occupied FROM guest_records WHERE business_id = ? AND is_deleted = false AND check_in >= ? AND check_in <= ? ${statusFilter}`, [businessId, firstDay, lastDay]);

  const recordIds = records.map(r => r.id);
  let breakdowns = [];
  if (recordIds.length > 0) {
    const [bdRows] = await db.pool.execute(`SELECT guest_record_id, country, sex, nationality, count, is_overseas FROM guest_breakdowns WHERE guest_record_id IN (${recordIds.map(() => '?').join(',')})`, recordIds);
    breakdowns = bdRows;
  }

  const recordGuestCount = {};
  breakdowns.forEach(b => { recordGuestCount[b.guest_record_id] = (recordGuestCount[b.guest_record_id] || 0) + _asInt(b.count); });

  const countryByDay = {};
  const residentsByDay = { 0: {} };
  const sexByDay = { 0: { male: {}, female: {} } };
  const roomsOccupiedByDay = {};
  const guestNightsByDay = {};
  const guestNightsPerArrivalDay = {};
  let totalGuestNights = 0;

  records.forEach(r => {
    const checkIn = new Date(r.check_in);
    const checkOut = new Date(r.check_out);
    const nights = Math.max(0, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
    const rooms = r.rooms_occupied || 0;
    const guestCount = recordGuestCount[r.id] || 0;
    const day = checkIn.getDate();

    if (nights > 0) {
      totalGuestNights += nights * guestCount;
      guestNightsPerArrivalDay[day] = (guestNightsPerArrivalDay[day] || 0) + (nights * guestCount);
      for (let n = 0; n < nights; n++) {
        const stayDate = new Date(checkIn);
        stayDate.setDate(checkIn.getDate() + n);
        if (stayDate.getFullYear() === year && (stayDate.getMonth() + 1) === month) {
          const stayDay = stayDate.getDate();
          roomsOccupiedByDay[stayDay] = (roomsOccupiedByDay[stayDay] || 0) + rooms;
          guestNightsByDay[stayDay] = (guestNightsByDay[stayDay] || 0) + guestCount;
        }
      }
    }
  });

  breakdowns.forEach(b => {
    const rec = records.find(r => r.id === b.guest_record_id);
    if (!rec) return;
    const day = new Date(rec.check_in).getDate();
    const country = (b.country || '').toUpperCase();
    const nationality = (b.nationality || '');
    const sex = (b.sex || '').toLowerCase();
    const bucket = _classifyResidenceBucket({ country, nationality, isOverseas: !!b.is_overseas });
    const count = _asInt(b.count);

    if (bucket === 'foreign_resident' && country) {
      if (!countryByDay[country]) countryByDay[country] = { 0: 0 };
      countryByDay[country][day] = (countryByDay[country][day] || 0) + count;
      countryByDay[country][0] = (countryByDay[country][0] || 0) + count;
    }
    residentsByDay[day] = residentsByDay[day] || {};
    residentsByDay[day][bucket] = (residentsByDay[day][bucket] || 0) + count;
    residentsByDay[0][bucket] = (residentsByDay[0][bucket] || 0) + count;

    sexByDay[day] = sexByDay[day] || { male: {}, female: {} };
    sexByDay[day][sex] = sexByDay[day][sex] || {};
    sexByDay[day][sex][bucket] = (sexByDay[day][sex][bucket] || 0) + count;
    sexByDay[0][sex][bucket] = (sexByDay[0][sex][bucket] || 0) + count;
  });

  return { month, countryByDay, residentsByDay, sexByDay, roomsOccupied: roomsOccupiedByDay, guestNightsByDay, guestNightsPerArrivalDay, guestNights: totalGuestNights };
}

function _mergeMonthData(month, list) {
  const countryByDay = {};
  const residentsByDay = { 0: {} };
  const sexByDay = { 0: { male: {}, female: {} } };
  const roomsOccupied = {};
  const guestNightsByDay = {};
  const guestNightsPerArrivalDay = {};
  let guestNights = 0;

  list.forEach(md => {
    Object.entries(md.countryByDay).forEach(([country, days]) => {
      countryByDay[country] = countryByDay[country] || {};
      Object.entries(days).forEach(([day, count]) => { countryByDay[country][day] = (countryByDay[country][day] || 0) + count; });
    });
    Object.entries(md.residentsByDay).forEach(([day, cats]) => {
      residentsByDay[day] = residentsByDay[day] || {};
      Object.entries(cats).forEach(([cat, count]) => { residentsByDay[day][cat] = (residentsByDay[day][cat] || 0) + count; });
    });
    Object.entries(md.sexByDay).forEach(([day, sexMap]) => {
      sexByDay[day] = sexByDay[day] || { male: {}, female: {} };
      Object.entries(sexMap).forEach(([sex, cats]) => {
        sexByDay[day][sex] = sexByDay[day][sex] || {};
        Object.entries(cats).forEach(([cat, count]) => { sexByDay[day][sex][cat] = (sexByDay[day][sex][cat] || 0) + count; });
      });
    });
    Object.entries(md.roomsOccupied).forEach(([day, count]) => { roomsOccupied[day] = (roomsOccupied[day] || 0) + count; });
    Object.entries(md.guestNightsByDay).forEach(([day, count]) => { guestNightsByDay[day] = (guestNightsByDay[day] || 0) + count; });
    Object.entries(md.guestNightsPerArrivalDay).forEach(([day, count]) => { guestNightsPerArrivalDay[day] = (guestNightsPerArrivalDay[day] || 0) + count; });
    guestNights += md.guestNights;
  });

  return { month, countryByDay, residentsByDay, sexByDay, roomsOccupied, guestNightsByDay, guestNightsPerArrivalDay, guestNights };
}

async function _archiveMonthRecords(month, year) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];
  const [records] = await db.pool.execute(`SELECT id FROM guest_records WHERE status = 'active' AND is_deleted = false AND check_in >= ? AND check_in <= ?`, [firstDay, lastDay]);
  const ids = records.map(r => r.id);
  if (ids.length > 0) {
    await db.pool.execute(`UPDATE guest_records SET status = 'archived' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
}

// ─── Excel Builders ──────────────────────────────────────────────────────────

function _buildDailySheet(sheet, biz, md, month, year, daysInMonth, adminName) {
  sheet.getCell('B3').value = { richText: [{ text: "Region: " }, { font: { bold: true, underline: true, size: 10, name: "Arial" }, text: biz.region || "4-A" }] };
  sheet.getCell('A4').value = biz.business_name;
  sheet.getCell('A5').value = `     ${kMonthNames[month]}, ${year}    `;

  const bizLines = typeof biz.business_line === 'string' ? JSON.parse(biz.business_line || '[]') : (biz.business_line || []);
  kAccTypes.forEach(t => {
    if (bizLines.includes(t.key)) {
      sheet.getCell(`B${t.row}`).value = '✔';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  sheet.getCell('A22').value = `City/Municipality: ${biz.city_municipality || ''}`;
  sheet.getCell('A23').value = `Province: ${biz.province || ''}`;

  const setDayValues = (rowNum, fn) => {
    for (let d = 1; d <= 31; d++) {
      const val = d <= daysInMonth ? fn(d) : '';
      sheet.getCell(rowNum, d + 1).value = val || null;
    }
  };

  const res = (d, cat) => md.residentsByDay[d]?.[cat] || 0;
  const cnt = (country, d) => md.countryByDay[country.toUpperCase()]?.[d] || 0;

  setDayValues(28, d => res(d, 'philippine_resident_filipino'));
  setDayValues(29, d => res(d, 'philippine_resident_foreign'));
  kCountryRows.forEach(c => setDayValues(c.row, d => cnt(c.country, d)));

  setDayValues(148, d => res(d, 'unspecified_guest'));
  setDayValues(151, d => res(d, 'overseas_filipino'));

  setDayValues(160, d => md.roomsOccupied[d] || 0);
  setDayValues(161, d => d <= daysInMonth ? biz.total_rooms : 0);
  setDayValues(162, d => md.guestNightsByDay[d] || 0);

  setDayValues(165, d => (d <= daysInMonth && biz.total_rooms > 0) ? ((md.roomsOccupied[d] || 0) / biz.total_rooms * 100).toFixed(2) : null);
  setDayValues(166, d => {
    if (d > daysInMonth) return null;
    const arrivals = Object.values(md.residentsByDay[d] || {}).reduce((a, b) => a + b, 0);
    return arrivals > 0 ? ((md.guestNightsPerArrivalDay[d] || 0) / arrivals).toFixed(2) : '0';
  });

  const sex = (d, s, cat) => md.sexByDay[d]?.[s]?.[cat] || 0;
  const setSexValues = (rowStart, gender) => {
    setDayValues(rowStart + 1, d => sex(d, gender, 'philippine_resident_filipino') + sex(d, gender, 'philippine_resident_foreign'));
    setDayValues(rowStart + 2, d => sex(d, gender, 'foreign_resident'));
    setDayValues(rowStart + 3, d => sex(d, gender, 'overseas_filipino'));
    setDayValues(rowStart + 4, d => sex(d, gender, 'unspecified_guest'));
  };
  setSexValues(170, 'male');
  setSexValues(177, 'female');

  sheet.getCell('A190').value = adminName.toUpperCase();
  sheet.getCell('AF188').value = `Date Submitted: ${new Date().toLocaleDateString()}`;
}

function _buildCountrySummarySheet(sheet, md, totalRoomsAll, month, year, daysInMonth, adminName) {
  sheet.getCell('B3').value = "Region: __4-A";
  sheet.getCell('A4').value = "All Accommodation Establishments — Combined";
  sheet.getCell('A5').value = `${kMonthNames[month]}, ${year}`;

  const res = (cat) => md.residentsByDay[0]?.[cat] || 0;
  const cnt = (country) => md.countryByDay[country.toUpperCase()]?.[0] || 0;

  sheet.getCell('B28').value = res('philippine_resident_filipino');
  sheet.getCell('B29').value = res('philippine_resident_foreign');
  kCountryRows.forEach(c => sheet.getCell(`B${c.row}`).value = cnt(c.country));

  sheet.getCell('B148').value = res('unspecified_guest');
  sheet.getCell('B151').value = res('overseas_filipino');

  const totalRoomsOcc = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  sheet.getCell('B160').value = totalRoomsOcc;
  sheet.getCell('B161').value = totalRoomsAll * daysInMonth;
  sheet.getCell('B162').value = md.guestNights;

  const grandTotal = res('philippine_resident_filipino') + res('philippine_resident_foreign') + Object.values(md.countryByDay).reduce((a, d) => a + (d[0] || 0), 0) + res('unspecified_guest') + res('overseas_filipino');
  sheet.getCell('B165').value = (totalRoomsAll * daysInMonth) > 0 ? (totalRoomsOcc / (totalRoomsAll * daysInMonth) * 100).toFixed(2) : '0';
  sheet.getCell('B166').value = grandTotal > 0 ? (md.guestNights / grandTotal).toFixed(2) : '0';

  const sex = (s, cat) => md.sexByDay[0]?.[s]?.[cat] || 0;
  const setSexValues = (rowStart, gender) => {
    sheet.getCell(`B${rowStart + 1}`).value = sex(gender, 'philippine_resident_filipino') + sex(gender, 'philippine_resident_foreign');
    sheet.getCell(`B${rowStart + 2}`).value = sex(gender, 'foreign_resident');
    sheet.getCell(`B${rowStart + 3}`).value = sex(gender, 'overseas_filipino');
    sheet.getCell(`B${rowStart + 4}`).value = sex(gender, 'unspecified_guest');
  };
  setSexValues(170, 'male');
  setSexValues(177, 'female');

  sheet.getCell('A190').value = adminName.toUpperCase();
}

function _buildMonthlySummarySheet(sheet, allMonths, totalRoomsAll, year, adminName) {
  sheet.getCell('B3').value = "Region: __4-A";
  sheet.getCell('A4').value = "All Accommodation Establishments — Combined";
  sheet.getCell('A5').value = `${year}`;

  const setMonthValues = (rowNum, fn) => {
    for (let m = 1; m <= 12; m++) { sheet.getCell(rowNum, m + 1).value = fn(m) || 0; }
  };

  const mdFor = (m) => allMonths.find(x => x.month === m) || { countryByDay: {}, residentsByDay: { 0: {} }, sexByDay: { 0: { male: {}, female: {} } }, roomsOccupied: {}, guestNights: 0 };
  const mRes = (m, cat) => mdFor(m).residentsByDay[0]?.[cat] || 0;
  const mCnt = (country, m) => mdFor(m).countryByDay[country.toUpperCase()]?.[0] || 0;

  setMonthValues(28, m => mRes(m, 'philippine_resident_filipino'));
  setMonthValues(29, m => mRes(m, 'philippine_resident_foreign'));
  kCountryRows.forEach(c => setMonthValues(c.row, m => mCnt(c.country, m)));

  setMonthValues(148, m => mRes(m, 'unspecified_guest'));
  setMonthValues(151, m => mRes(m, 'overseas_filipino'));

  sheet.getCell('A190').value = adminName.toUpperCase();
}

// ─── PDF Generation ──────────────────────────────────────────────────────────

async function _generatePdfFromWorkbook(workbook, pdfPath, month, year) {
  const doc = new PDFDocument({ layout: 'landscape', size: 'A3', margin: 20 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  workbook.eachSheet((sheet, sheetIdx) => {
    if (sheetIdx > 1) doc.addPage();

    const pointsPerExcelHeight = 0.75; 
    const pointsPerExcelWidth = 5.25;  

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

        let boxWidth = colWidth;
        let boxHeight = rowHeight;
        if (cell.isMerged) {
           const mergeRange = _findMergeRange(sheet, cell.address);
           if (mergeRange) {
              boxWidth = 0;
              for (let c = mergeRange.left; c <= mergeRange.right; c++) { boxWidth += (sheet.getColumn(c).width || 10) * pointsPerExcelWidth; }
              boxHeight = 0;
              for (let r = mergeRange.top; r <= mergeRange.bottom; r++) { boxHeight += (sheet.getRow(r).height || 15) * pointsPerExcelHeight; }
           }
        }

        if (cell.fill && cell.fill.fgColor && cell.fill.fgColor.argb) {
          doc.rect(currentX, currentY, boxWidth, boxHeight).fill('#' + cell.fill.fgColor.argb.substring(2));
        }

        if (cell.border) {
           doc.lineWidth(0.5).strokeColor('#000000');
           if (cell.border.top) { doc.moveTo(currentX, currentY).lineTo(currentX + boxWidth, currentY).stroke(); }
           if (cell.border.bottom) { doc.moveTo(currentX, currentY + boxHeight).lineTo(currentX + boxWidth, currentY + boxHeight).stroke(); }
           if (cell.border.left) { doc.moveTo(currentX, currentY).lineTo(currentX, currentY + boxHeight).stroke(); }
           if (cell.border.right) { doc.moveTo(currentX + boxWidth, currentY).lineTo(currentX + boxWidth, currentY + boxHeight).stroke(); }
        }

        let text = "";
        if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
           text = cell.value.richText.map(rt => rt.text).join('');
        } else if (cell.value && cell.value.result !== undefined) {
           text = cell.value.result.toString();
        } else if (cell.value !== null && cell.value !== undefined) {
           text = cell.value.toString();
        }

        if (text) {
          const fontSize = (cell.font && cell.font.size) ? cell.font.size * 0.8 : 7;
          const isBold = cell.font && cell.font.bold;
          const isItalic = cell.font && cell.font.italic;
          const color = (cell.font && cell.font.color && cell.font.color.argb) ? '#' + cell.font.color.argb.substring(2) : '#000000';

          doc.fillColor(color).font(isBold ? (isItalic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (isItalic ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(fontSize);

          const align = cell.alignment ? cell.alignment.horizontal : 'left';
          doc.text(text, currentX + 2, currentY + 2, { width: boxWidth - 4, height: boxHeight - 4, align: align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left'), ellipsis: true });
        }

        currentX += colWidth;
      });
      currentY += rowHeight;
    });
  });

  doc.end();
  return new Promise((resolve) => stream.on('finish', resolve));
}

function _findMergeRange(sheet, address) {
   for (const merge of Object.values(sheet._merges || {})) {
      if (address === merge.model.top + "" + merge.model.left || address === sheet.getCell(merge.model.top, merge.model.left).address) {
         return merge.model;
      }
      // Check if address is within range
      const cell = sheet.getCell(address);
      if (cell.master.address === sheet.getCell(merge.model.top, merge.model.left).address) {
         return merge.model;
      }
   }
   return null;
}

export default router;
