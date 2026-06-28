import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import cloudinary from '../config/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const adminGuard = [auth.authenticate, auth.requireRole('admin')];

const UPLOADS_DIR = path.join(__dirname, '../../uploads/reports');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const TEMPLATE_PATH = path.join(__dirname, '../../sample/ON Blank Form.xlsx');

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
// The generated report needs zero named ranges. Any that survive from the
// template reference the deleted template sheets, causing Excel's
// "Removed Records: Named range" recovery dialog on open.
//
// ExcelJS stores defined names differently across major versions:
//   v4.x  →  workbook._definedNames._defined  (plain object, keyed by name)
//   v3.x  →  workbook._definedNames.model     (array)
//   other →  various internal Map/object stores
//
// We try every known path and wipe unconditionally.
function _purgeOrphanedDefinedNames(workbook) {
  try {
    const dn = workbook.definedNames;
    if (dn) dn.model = [];
  } catch (err) {
    console.warn('[report] Named-range cleanup skipped:', err.message);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/reports', adminGuard, async (req, res, next) => {
  try {
    const [rows] = await db.pool.execute(
      `SELECT r.id, r.batch_id, r.business_id, r.report_type, r.file_url,
               rb.report_scope, rb.period_month, rb.period_year,
               rb.generated_at, rb.generated_by,
               u.full_name AS generated_by_name,
               b.business_name
        FROM reports r
        JOIN report_batches rb ON rb.id = r.batch_id
        LEFT JOIN businesses b  ON b.id  = r.business_id
        LEFT JOIN users     u  ON rb.generated_by = u.id
        ORDER BY rb.generated_at DESC`
    );
    const data = rows.map(row => ({
      ...row,
      pdf_url: row.file_url
        ? row.file_url.includes('/excel.xlsx')
          ? row.file_url.replace('/excel.xlsx', '/pdf.pdf')
          : row.file_url.replace('.xlsx', '.pdf')
        : null,
      report_type: row.report_type || 'business',
    }));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/reports/generate', adminGuard, async (req, res, next) => {
  try {
    const { month, year, scope } = req.body;

    if (!['monthly', 'annual'].includes(scope)) {
      return res.status(400).json({ message: 'scope must be "monthly" or "annual"' });
    }

    const effectiveMonth = scope === 'annual' ? 12 : month;

    // ── Check for existing batch ─────────────────────────────────────────────
    const dupQuery = scope === 'annual'
      ? 'SELECT id FROM report_batches WHERE report_scope = ? AND period_year = ? LIMIT 1'
      : 'SELECT id FROM report_batches WHERE report_scope = ? AND period_month = ? AND period_year = ? LIMIT 1';
    const dupParams = scope === 'annual' ? [scope, year] : [scope, effectiveMonth, year];
    const [existingBatch] = await db.pool.execute(dupQuery, dupParams);
    if (existingBatch.length > 0) {
      const label = scope === 'annual' ? String(year) : `${kMonthNames[month]} ${year}`;
      return res.status(400).json({
        message: `A ${scope} report batch for ${label} already exists.`
      });
    }

    // ── Fetch approved businesses ────────────────────────────────────────────
    const [businesses] = await db.pool.execute(
      `SELECT id, business_name, business_line, region, city_municipality, province, total_rooms,
              owner_first_name, owner_last_name, owner_middle_name
       FROM businesses WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY business_name`
    );

    if (businesses.length === 0) {
      return res.status(400).json({ message: 'No approved businesses found.' });
    }

    const [userRows] = await db.pool.execute('SELECT full_name, role FROM users WHERE id = ?', [req.user.id]);
    const adminName = userRows[0]?.full_name || 'System Admin';

    // ── Transaction: create batch + insert all reports atomically ────────────
    await db.pool.query('START TRANSACTION');

    const batchId = uuidv4();
    await db.pool.execute(
      `INSERT INTO report_batches (id, report_scope, period_month, period_year, generated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [batchId, scope, effectiveMonth, year, req.user.id]
    );

    const daysInMonth = new Date(year, month, 0).getDate();
    const timestamp = Date.now();
    const writtenFiles = [];
    const reportResults = [];

    const includeDaily       = scope === 'monthly';
    const includeCountrySum  = scope === 'monthly';
    const includeMonthlySum  = scope === 'annual';
    const monthLabel = scope === 'annual' ? 'ANNUAL' : String(month).padStart(2, '0');

    // ── Aggregation collectors for totals report ───────────────────────────────
    const allBizMonthData = [];
    const allBizAnnualData = [];
    let totalRoomsSum = 0;
    const unionLines = new Set();

    try {
      // ── Process each business sequentially ─────────────────────────────────
      for (const biz of businesses) {
        // Fetch 12 months of data if annual summary needed
        let bizAllMonths = null;
        if (includeMonthlySum) {
          bizAllMonths = [];
          for (let m = 1; m <= 12; m++) {
            const md = await _fetchMonthData(biz.id, m, year, true);
            bizAllMonths.push(md);
          }
        }

        // Fetch single-month data for monthly scope (also used for daily/sum sheets)
        const bizData = includeDaily || includeCountrySum
          ? await _fetchMonthData(biz.id, month, year)
          : null;

        // Collect for totals aggregation
        if (includeDaily || includeCountrySum) allBizMonthData.push(bizData);
        if (includeMonthlySum)                allBizAnnualData.push(bizAllMonths);
        totalRoomsSum += biz.total_rooms || 0;
        if (Array.isArray(biz.business_line)) biz.business_line.forEach(l => unionLines.add(l));

        // ── Create workbook for this business ────────────────────────────────
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(TEMPLATE_PATH);

        const dailyTpl   = wb.getWorksheet('Name of Establishment');
        const sumTpl     = wb.getWorksheet('AE DAE-1B by Country (Sum) ');
        const monthTpl   = wb.getWorksheet('AE DAE-1B (Monthly)');

        if (!dailyTpl || !sumTpl || !monthTpl) {
          throw new Error('Template worksheets not found. Check sheet names in template file.');
        }

        // Build daily sheet (monthly scope only)
        if (includeDaily && bizData) {
          const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
          const sheet = wb.addWorksheet(sheetName);
          _copySheetProperties(dailyTpl, sheet);
          for (let c = 1; c <= 33; c++) {
            const col = sheet.getColumn(c);
            if (col.width) col.width = Math.round(col.width * 1.0 * 10) / 10;
          }
          _buildDailySheet(sheet, biz, bizData, month, year, daysInMonth, adminName);
        }

        // Build country summary sheet (monthly scope only)
        if (includeCountrySum && bizData) {
          const sheet = wb.addWorksheet('AE DAE-1B by Country (Sum)');
          _copySheetProperties(sumTpl, sheet);
          _buildCountrySummarySheet(sheet, bizData, biz.total_rooms, month, year, daysInMonth, adminName, biz.city_municipality || '', biz.province || '', biz.business_name, biz);
        }

        // Build annual monthly-summary sheet (annual scope only)
        if (includeMonthlySum && bizAllMonths) {
          const sheet = wb.addWorksheet('AE DAE-1B (Monthly) Summary');
          _copySheetProperties(monthTpl, sheet);
          _buildMonthlySummarySheet(sheet, bizAllMonths, biz.total_rooms, year, adminName, biz.city_municipality || '', biz.province || '', biz.business_name, biz);
        }

        // Remove template sheets
        wb.removeWorksheet(dailyTpl.id);
        wb.removeWorksheet(sumTpl.id);
        wb.removeWorksheet(monthTpl.id);

        _purgeOrphanedDefinedNames(wb);
        wb.eachSheet(ws => {
          if (ws.pageSetup) {
            ws.pageSetup.printArea = null;
            delete ws.pageSetup.printTitlesRow;
            delete ws.pageSetup.printTitlesColumn;
          }
        });

        // Write Excel file (temp)
        const bizSlug = biz.business_name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').substring(0, 30);
        const excelFileName = `DAE1B_${bizSlug}_${year}_${monthLabel}_${timestamp}.xlsx`;
        const excelPath = path.join(UPLOADS_DIR, excelFileName);
        await wb.xlsx.writeFile(excelPath);
        writtenFiles.push(excelPath);

        // Generate PDF (temp)
        const pdfFileName = excelFileName.replace('.xlsx', '.pdf');
        const pdfPath = path.join(UPLOADS_DIR, pdfFileName);
        await _generatePdfFromWorkbook(wb, pdfPath, month, year);
        writtenFiles.push(pdfPath);

        // Upload Excel to Cloudinary
        const reportId = uuidv4();
        const excelUpload = await cloudinary.uploader.upload(excelPath, {
          resource_type: 'raw',
          folder: 'tourism/reports',
          public_id: `${reportId}/excel`,
          overwrite: true,
        });
        const excelUrl = excelUpload.secure_url;

        // Upload PDF to Cloudinary
        await cloudinary.uploader.upload(pdfPath, {
          resource_type: 'raw',
          folder: 'tourism/reports',
          public_id: `${reportId}/pdf`,
          overwrite: true,
        });

        // Remove local temp files
        try { fs.unlinkSync(excelPath); } catch (e) { /* best effort */ }
        try { fs.unlinkSync(pdfPath); } catch (e) { /* best effort */ }

        // Insert report row
        await db.pool.execute(
          `INSERT INTO reports (id, batch_id, business_id, report_type, file_url) VALUES (?, ?, ?, 'business', ?)`,
          [reportId, batchId, biz.id, excelUrl]
        );

        reportResults.push({ reportId, businessId: biz.id, businessName: biz.business_name, fileUrl: excelUrl });
      }

      // ── Build totals workbook across all businesses ─────────────────────────
      const totalBiz = {
        business_name:  'TOTAL \u2013 ALL ACCOMMODATION',
        total_rooms:    totalRoomsSum,
        business_line:  [...unionLines],
        region:         '', city_municipality: 'San Pablo City', province: 'Laguna',
      };

      const wbTotal = new ExcelJS.Workbook();
      await wbTotal.xlsx.readFile(TEMPLATE_PATH);
      const totalDailyTpl = wbTotal.getWorksheet('Name of Establishment');
      const totalSumTpl   = wbTotal.getWorksheet('AE DAE-1B by Country (Sum) ');
      const totalMonthTpl = wbTotal.getWorksheet('AE DAE-1B (Monthly)');

      // Rename template sheets so addWorksheet with the same name doesn't clash
      totalDailyTpl.name = '_TEMPLATE_Daily';
      totalSumTpl.name   = '_TEMPLATE_Sum';
      totalMonthTpl.name = '_TEMPLATE_Monthly';

      if (scope === 'monthly' && allBizMonthData.length > 0) {
        const mergedMd = _mergeMonthData(month, allBizMonthData);

        const dailySheet = wbTotal.addWorksheet('Name of Establishment');
        _copySheetProperties(totalDailyTpl, dailySheet);
        _buildDailySheet(dailySheet, totalBiz, mergedMd, month, year, daysInMonth, adminName);

        const sumSheet = wbTotal.addWorksheet('AE DAE-1B by Country (Sum)');
        _copySheetProperties(totalSumTpl, sumSheet);
        _buildCountrySummarySheet(sumSheet, mergedMd, totalRoomsSum, month, year, daysInMonth, adminName, 'San Pablo City', 'Laguna', totalBiz.business_name, totalBiz);
      }

      if (scope === 'annual' && allBizAnnualData.length > 0) {
        const mergedMonths = [];
        for (let m = 1; m <= 12; m++) {
          const monthDataList = allBizAnnualData.map(b => b[m - 1]);
          mergedMonths.push(_mergeMonthData(m, monthDataList));
        }

        const mSheet = wbTotal.addWorksheet('AE DAE-1B (Monthly) Summary');
        _copySheetProperties(totalMonthTpl, mSheet);
        _buildMonthlySummarySheet(mSheet, mergedMonths, totalRoomsSum, year, adminName, 'San Pablo City', 'Laguna', totalBiz.business_name, totalBiz);
      }

      // Remove template sheets from totals workbook
      wbTotal.removeWorksheet(totalDailyTpl.id);
      wbTotal.removeWorksheet(totalSumTpl.id);
      wbTotal.removeWorksheet(totalMonthTpl.id);
      _purgeOrphanedDefinedNames(wbTotal);
      wbTotal.eachSheet(ws => {
        if (ws.pageSetup) {
          ws.pageSetup.printArea = null;
          delete ws.pageSetup.printTitlesRow;
          delete ws.pageSetup.printTitlesColumn;
        }
      });

      // Write totals Excel + PDF
      const totalId = uuidv4();
      const totalExcelName = `DAE1B_TOTAL_ALL_${year}_${monthLabel}_${timestamp}.xlsx`;
      const totalExcelPath = path.join(UPLOADS_DIR, totalExcelName);
      await wbTotal.xlsx.writeFile(totalExcelPath);
      writtenFiles.push(totalExcelPath);

      const totalPdfPath = totalExcelPath.replace('.xlsx', '.pdf');
      await _generatePdfFromWorkbook(wbTotal, totalPdfPath, month, year);
      writtenFiles.push(totalPdfPath);

      const totalExcelUpload = await cloudinary.uploader.upload(totalExcelPath, {
        resource_type: 'raw',
        folder: 'tourism/reports',
        public_id: `${totalId}/excel`,
        overwrite: true,
      });

      await cloudinary.uploader.upload(totalPdfPath, {
        resource_type: 'raw',
        folder: 'tourism/reports',
        public_id: `${totalId}/pdf`,
        overwrite: true,
      });

      try { fs.unlinkSync(totalExcelPath); } catch (e) { /* best effort */ }
      try { fs.unlinkSync(totalPdfPath); } catch (e) { /* best effort */ }

      await db.pool.execute(
        `INSERT INTO reports (id, batch_id, business_id, report_type, file_url) VALUES (?, ?, NULL, 'total', ?)`,
        [totalId, batchId, totalExcelUpload.secure_url]
      );

      reportResults.push({ reportId: totalId, businessId: null, businessName: totalBiz.business_name, fileUrl: totalExcelUpload.secure_url });

      // ── Commit transaction ───────────────────────────────────────────────
      await db.pool.query('COMMIT');

      // ── Archive month records (monthly scope only) ─────────────────────────
      if (scope === 'monthly') {
        await _archiveMonthRecords(month, year);
      }

      res.json({
        message: 'Reports generated successfully',
        batchId,
        reportCount: reportResults.length,
        reports: reportResults,
      });
    } catch (innerErr) {
      // ── Rollback: roll back transaction and delete all written files ──────
      console.error('Report generation failed — rolling back:', innerErr.message);
      try {
        await db.pool.query('ROLLBACK');
      } catch (dbErr) {
        console.error('Rollback DB error:', dbErr.message);
      }
      for (const f of writtenFiles) {
        try { fs.unlinkSync(f); } catch (e) { /* best effort */ }
      }
      throw innerErr;
    }
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
        if (cell.formula && cell.formula.includes('!')) {
          // ── FIX: "Bake" cross-sheet formulas ───────────────────────────────
          // Formulas like ='Sheet'!A1 will break when the source sheet is
          // deleted. Replacing them with their cached result avoids #REF!.
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
    }

    // Spread rooms-occupied across each stay-night (at minimum the check-in day)
    // so same-day stays (nights === 0) still count their rooms.
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

  // ── Arrival / residency / country tallies (all records with a valid day) ────
  breakdowns.forEach(b => {
    const day = recordDay[b.guest_record_id];
    if (!day) return;

    const country     = (b.country || '').toUpperCase();
    const nationality = (b.nationality || '');
    const sex         = (b.sex || '').toLowerCase();
    const rawBucket   = _classifyResidenceBucket({ country, nationality, isOverseas: !!b.is_overseas });
    const count       = _asInt(b.count);

    // All foreign residents go into countryByDay (listed and unlisted countries).
    // _otherCountriesTotal() later computes the unlisted subset for display.
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

// ==============================================================================================
// ======================================== DAILY SHEET =========================================
// ==============================================================================================


function _buildDailySheet(sheet, biz, md, month, year, daysInMonth, adminName) {
  const r = kRows.daily;

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
  setDayValues(r.phResFilipino, d => res(d, 'philippine_resident_filipino'));
  setDayValues(r.phResForeign, d => res(d, 'philippine_resident_foreign'));
  
  // TOTAL PHILIPPINE RESIDENTS
  setDayValues(r.phResTotal, d => res(d, 'philippine_resident_filipino') + res(d, 'philippine_resident_foreign'));

  kCountryRows.forEach(c => setDayValues(c.daily, d => cnt(c.country, d)));

  // ── Regional Subtotals (Daily) ──────────────────────────────────────────────
  kRegionalGroups.forEach(g => {
    setDayValues(g.dailyRow, d => {
      return g.countries.reduce((sum, country) => sum + cnt(country, d), 0);
    });
  });

  // FIX: write catch-all "Other Countries" row so unlisted foreign nationals
  // are not silently dropped from the sheet.
  // LOGIC: Row 139/140 is "OTHERS AND UNSPECIFIED". It should include unlisted countries
  // PLUS the 'unspecified_guest' bucket (OTHERS, UNKNOWN, empty).
  setDayValues(r.otherCountries, d => res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));

  // TOTAL FOREIGN RESIDENTS
  // LOGIC: Row 141/142 "TOTAL NON-PHILIPPINE RESIDENTS" (Listed + Unlisted + Unspecified)
  setDayValues(r.totalForeign, d => res(d, 'listed_foreign_resident') + res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));

  setDayValues(r.unspecified, d => res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));
  setDayValues(r.overseasFilipino, d => res(d, 'overseas_filipino'));

  // GRAND TOTAL
  setDayValues(r.grandTotal, d => {
    return res(d, 'philippine_resident_filipino') +
           res(d, 'philippine_resident_foreign') +
           res(d, 'listed_foreign_resident') +
           res(d, 'unlisted_foreign_resident') +
           res(d, 'unspecified_guest') +
           res(d, 'overseas_filipino');
  });

  // ── Summary Rows (After Grand Total) ────────────────────────────────────────
  setDayValues(r.summaryPhTotal, d => res(d, 'philippine_resident_filipino') + res(d, 'philippine_resident_foreign'));
  setDayValues(r.summaryForeignTotal, d => res(d, 'listed_foreign_resident') + res(d, 'unlisted_foreign_resident') + res(d, 'unspecified_guest'));
  setDayValues(r.summaryOverseasTotal, d => res(d, 'overseas_filipino'));

  // ── Rooms & guest-nights ────────────────────────────────────────────────────
  setDayValues(r.roomsOccupied, d => md.roomsOccupied[d] || 0);
  setDayValues(r.roomsAvailable, () => biz.total_rooms);
  setDayValues(r.guestNights, d => md.guestNightsByDay[d] || 0);

  // ── Computed metrics ─────────────────────────────────────────────────────────
  // Occupancy rate = rooms used / total rooms × 100  (stored as a real number)
  setDayValues(r.occupancyRate, d => {
    if (!biz.total_rooms) return 0;
    return parseFloat(((md.roomsOccupied[d] || 0) / biz.total_rooms * 100).toFixed(2));
  });
  // ALOS for arrivals on day d = total guest-nights generated by those arrivals
  // divided by the number of guests who checked in on day d.
  setDayValues(r.alos, d => {
    const arrivals = Object.values(md.residentsByDay[d] || {}).reduce((a, b) => a + b, 0);
    if (!arrivals) return 0;
    return parseFloat(((md.guestNightsPerArrivalDay[d] || 0) / arrivals).toFixed(2));
  });

  // ── Sex breakdown ────────────────────────────────────────────────────────────
  // FIX: corrected offsets (+0 to +4) to ensure data aligns with labels in template
  const setSexValues = (rowStart, gender) => {
    setDayValues(rowStart + 1, d => sex(d, gender, 'philippine_resident_filipino') + sex(d, gender, 'philippine_resident_foreign'));
    // b. Non-Philippine/Foreign Residents (including unspecified)
    setDayValues(rowStart + 2, d => sex(d, gender, 'listed_foreign_resident') + sex(d, gender, 'unlisted_foreign_resident') + sex(d, gender, 'unspecified_guest'));
    setDayValues(rowStart + 3, d => sex(d, gender, 'overseas_filipino'));
    // d. Others/Unspecified Guest
    setDayValues(rowStart + 4, d => sex(d, gender, 'unlisted_foreign_resident') + sex(d, gender, 'unspecified_guest'));
    // TOTAL per sex
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

  // ── FIX: Total column (AG = kTotalCol) ─────────────────────────────────────
  // Writes the month grand-total to column AG for every data row.
  // If the template already has SUM formulas there, this overwrites them with
  // equivalent hard-coded numbers (more reliable — no formula recalculation risk).
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

  // Residency totals
  writeTotal(r.phResFilipino, md.residentsByDay[0]?.['philippine_resident_filipino'] ?? 0);
  writeTotal(r.phResForeign, md.residentsByDay[0]?.['philippine_resident_foreign'] ?? 0);
  writeTotal(r.phResTotal, phTotal);

  kCountryRows.forEach(c =>
    writeTotal(c.daily, md.countryByDay[c.country]?.[0] ?? 0)
  );

  // ── Regional Subtotals (Totals Column) ──────────────────────────────────────
  kRegionalGroups.forEach(g => {
    const subtotal = g.countries.reduce((sum, country) => {
      return sum + (md.countryByDay[country.toUpperCase()]?.[0] ?? 0);
    }, 0);
    writeTotal(g.dailyRow, subtotal);
  });

  const othersAndUnspecifiedTotalAG = unlistedForeignTotal + unspecifiedTotal;
  const totalForeignAG = listedForeignTotal + unlistedForeignTotal + unspecifiedTotal;

  writeTotal(r.otherCountries, othersAndUnspecifiedTotalAG);
  writeTotal(r.totalForeign, totalForeignAG);

  writeTotal(r.unspecified, othersAndUnspecifiedTotalAG);
  writeTotal(r.overseasFilipino, overseasTotal);
  writeTotal(r.grandTotal, grandTotalAll);

  // ── Summary Rows (Totals Column) ──────────────────────────────────────────
  writeTotal(r.summaryPhTotal, phTotal);
  writeTotal(r.summaryForeignTotal, totalForeignAG);
  writeTotal(r.summaryOverseasTotal, overseasTotal);

  // Rooms & nights totals
  const totalRoomsOccAll = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalRoomsAvail  = (biz.total_rooms || 0) * daysInMonth;
  writeTotal(r.roomsOccupied, totalRoomsOccAll);
  writeTotal(r.roomsAvailable, totalRoomsAvail);
  writeTotal(r.guestNights, md.guestNights);

  // Occupancy rate for the full month
  writeTotal(r.occupancyRate, totalRoomsAvail > 0
    ? parseFloat((totalRoomsOccAll / totalRoomsAvail * 100).toFixed(2))
    : 0
  );
  // ALOS for the full month = total guest-nights / total arrivals
  const grandTotalArrivals = Object.values(md.residentsByDay[0] ?? {}).reduce((a, b) => a + b, 0);
  writeTotal(r.alos, grandTotalArrivals > 0
    ? parseFloat((md.guestNights / grandTotalArrivals).toFixed(2))
    : 0
  );

  // Sex breakdown totals
  // FIX: corrected offsets (+0 to +4) to ensure data aligns with labels in template
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
      sheet.getCell(`B${t.row}`).value     = '✔';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  const res = cat     => md.residentsByDay[0]?.[cat] || 0;
  const cnt = country => md.countryByDay[country.toUpperCase()]?.[0] || 0;
  const sex = (s, cat) => md.sexByDay[0]?.[s]?.[cat] || 0;

  // ── Residency rows (column B = grand total for the month) ────────────────────
  sheet.getCell(`B${r.phResFilipino}`).value = res('philippine_resident_filipino');
  sheet.getCell(`B${r.phResForeign}`).value = res('philippine_resident_foreign');
  
  // TOTAL PHILIPPINE RESIDENTS
  sheet.getCell(`B${r.phResTotal}`).value = res('philippine_resident_filipino') + res('philippine_resident_foreign');

  kCountryRows.forEach(c => { sheet.getCell(`B${c.sum}`).value = cnt(c.country); });

  // ── Regional Subtotals (Sum) ────────────────────────────────────────────────
  kRegionalGroups.forEach(g => {
    const subtotal = g.countries.reduce((sum, country) => sum + cnt(country), 0);
    sheet.getCell(`B${g.sumRow}`).value = subtotal;
  });

  // FIX: write catch-all "Other Countries" total
  // Row 140 is "OTHERS AND UNSPECIFIED".
  const othersAndUnspecifiedTotal = res('unlisted_foreign_resident') + res('unspecified_guest');
  sheet.getCell(`B${r.otherCountries}`).value = othersAndUnspecifiedTotal;

  // TOTAL FOREIGN RESIDENTS
  // Row 142 "TOTAL NON-PHILIPPINE RESIDENTS" (Listed + Unlisted + Unspecified)
  sheet.getCell(`B${r.totalForeign}`).value = res('listed_foreign_resident') + res('unlisted_foreign_resident') + res('unspecified_guest');

  sheet.getCell(`B${r.unspecified}`).value = othersAndUnspecifiedTotal;
  sheet.getCell(`B${r.overseasFilipino}`).value = res('overseas_filipino');

  // GRAND TOTAL
  const grandTotal =
    res('philippine_resident_filipino') +
    res('philippine_resident_foreign') +
    res('listed_foreign_resident') +
    res('unlisted_foreign_resident') +
    res('unspecified_guest') +
    res('overseas_filipino');
  sheet.getCell(`B${r.grandTotal}`).value = grandTotal;

  // ── Summary Rows (After Grand Total) ────────────────────────────────────────
  sheet.getCell(`B${r.summaryPhTotal}`).value = res('philippine_resident_filipino') + res('philippine_resident_foreign');
  sheet.getCell(`B${r.summaryForeignTotal}`).value = res('listed_foreign_resident') + res('unlisted_foreign_resident') + res('unspecified_guest');
  sheet.getCell(`B${r.summaryOverseasTotal}`).value = res('overseas_filipino');

  // ── Rooms & nights ──────────────────────────────────────────────────────────
  const totalRoomsOcc  = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalAvailRoom = totalRoomsAll * daysInMonth;
  sheet.getCell(`B${r.roomsOccupied}`).value = totalRoomsOcc;
  sheet.getCell(`B${r.roomsAvailable}`).value = totalAvailRoom;
  sheet.getCell(`B${r.guestNights}`).value = md.guestNights;

  // ── Computed metrics ─────────────────────────────────────────────────────────
  sheet.getCell(`B${r.occupancyRate}`).value = totalAvailRoom > 0
    ? parseFloat((totalRoomsOcc / totalAvailRoom * 100).toFixed(2))
    : 0;
  sheet.getCell(`B${r.alos}`).value = grandTotal > 0
    ? parseFloat((md.guestNights / grandTotal).toFixed(2))
    : 0;

  // ── Sex breakdown ────────────────────────────────────────────────────────────
  // FIX: corrected offsets (+0 to +4) to ensure data aligns with labels in template
  const setSexValues = (rowStart, gender) => {
    sheet.getCell(`B${rowStart + 1}`).value = sex(gender, 'philippine_resident_filipino') + sex(gender, 'philippine_resident_foreign');
    // b. Non-Philippine/Foreign Residents (including unspecified)
    sheet.getCell(`B${rowStart + 2}`).value = sex(gender, 'listed_foreign_resident') + sex(gender, 'unlisted_foreign_resident') + sex(gender, 'unspecified_guest');
    sheet.getCell(`B${rowStart + 3}`).value = sex(gender, 'overseas_filipino');
    // d. Others/Unspecified Guest
    sheet.getCell(`B${rowStart + 4}`).value = sex(gender, 'unlisted_foreign_resident') + sex(gender, 'unspecified_guest');
    // TOTAL per sex
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
// ======================================== MONTHLY SUMMARY =========================================
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
      sheet.getCell(`B${t.row}`).value     = '✔';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  // Sets values for months 1-12 into columns B-M (col index 2-13).
  // Also calculates the total for the year and writes to Column N (14).
  const setMonthValues = (rowNum, fn) => {
    let yearTotal = 0;
    for (let m = 1; m <= 12; m++) {
      const val = fn(m) ?? 0;
      sheet.getCell(rowNum, m + 1).value = val;
      if (typeof val === 'number') yearTotal += val;
    }
    sheet.getCell(rowNum, 14).value = yearTotal;
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
  setMonthValues(r.phResFilipino, m => mRes(m, 'philippine_resident_filipino'));
  setMonthValues(r.phResForeign, m => mRes(m, 'philippine_resident_foreign'));
  
  // TOTAL PHILIPPINE RESIDENTS
  setMonthValues(r.phResTotal, m => mRes(m, 'philippine_resident_filipino') + mRes(m, 'philippine_resident_foreign'));

  kCountryRows.forEach(c => setMonthValues(c.sum, m => mCnt(c.country, m)));

  // ── Regional Subtotals (Monthly Summary) ────────────────────────────────────
  kRegionalGroups.forEach(g => {
    setMonthValues(g.sumRow, m => {
      return g.countries.reduce((sum, country) => sum + mCnt(country, m), 0);
    });
  });

  // FIX: write "Other Countries" row for monthly sheet
  // Row 140 is "OTHERS AND UNSPECIFIED".
  setMonthValues(r.otherCountries, m => {
    const md = mdFor(m);
    return (md.residentsByDay[0]?.['unlisted_foreign_resident'] || 0) + (md.residentsByDay[0]?.['unspecified_guest'] || 0);
  });

  // TOTAL FOREIGN RESIDENTS
  // Row 142 "TOTAL NON-PHILIPPINE RESIDENTS" (Listed + Unlisted + Unspecified)
  setMonthValues(r.totalForeign, m => {
    const md = mdFor(m);
    const res = md.residentsByDay[0] || {};
    return (res['listed_foreign_resident'] || 0) + (res['unlisted_foreign_resident'] || 0) + (res['unspecified_guest'] || 0);
  });

  setMonthValues(r.unspecified, m => {
    const md = mdFor(m);
    return (md.residentsByDay[0]?.['unlisted_foreign_resident'] || 0) + (md.residentsByDay[0]?.['unspecified_guest'] || 0);
  });
  setMonthValues(r.overseasFilipino, m => mRes(m, 'overseas_filipino'));

  // GRAND TOTAL
  setMonthValues(r.grandTotal, m => {
    const md = mdFor(m).residentsByDay[0] || {};
    return (md.philippine_resident_filipino || 0) +
           (md.philippine_resident_foreign || 0) +
           (md.listed_foreign_resident || 0) +
           (md.unlisted_foreign_resident || 0) +
           (md.unspecified_guest || 0) +
           (md.overseas_filipino || 0);
  });

  // ── Summary Rows (After Grand Total) ────────────────────────────────────────
  setMonthValues(r.summaryPhTotal, m => mRes(m, 'philippine_resident_filipino') + mRes(m, 'philippine_resident_foreign'));
  setMonthValues(r.summaryForeignTotal, m => {
    const res = mdFor(m).residentsByDay[0] || {};
    return (res['listed_foreign_resident'] || 0) + (res['unlisted_foreign_resident'] || 0) + (res['unspecified_guest'] || 0);
  });
  setMonthValues(r.summaryOverseasTotal, m => mRes(m, 'overseas_filipino'));

  // ── Rooms & nights ──────────────────────────────────────────────────────────
  setMonthValues(r.roomsOccupied, m => Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0));
  setMonthValues(r.roomsAvailable, m => totalRoomsAll * new Date(year, m, 0).getDate());
  setMonthValues(r.guestNights, m => mdFor(m).guestNights);

  // ── Computed metrics ─────────────────────────────────────────────────────────
  for (let m = 1; m <= 12; m++) {
    const daysInM    = new Date(year, m, 0).getDate();
    const totalAvail = totalRoomsAll * daysInM;
    const totalOcc   = Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0);
    sheet.getCell(r.occupancyRate, m + 1).value = totalAvail > 0
      ? parseFloat((totalOcc / totalAvail * 100).toFixed(2))
      : 0;

    const md = mdFor(m).residentsByDay[0] || {};
    const grandTotal =
      (md.philippine_resident_filipino || 0) +
      (md.philippine_resident_foreign || 0) +
      (md.listed_foreign_resident || 0) +
      (md.unlisted_foreign_resident || 0) +
      (md.unspecified_guest || 0) +
      (md.overseas_filipino || 0);
    sheet.getCell(r.alos, m + 1).value = grandTotal > 0
      ? parseFloat((mdFor(m).guestNights / grandTotal).toFixed(2))
      : 0;
  }

  // Yearly totals for metrics (Column N / 14)
  const yrOccTotal = allMonths.reduce((sum, m) => sum + Object.values(m.roomsOccupied).reduce((a, b) => a + b, 0), 0);
  const yrAvailTotal = [1,2,3,4,5,6,7,8,9,10,11,12].reduce((sum, m) => sum + totalRoomsAll * new Date(year, m, 0).getDate(), 0);
  sheet.getCell(r.occupancyRate, 14).value = yrAvailTotal > 0 ? parseFloat((yrOccTotal / yrAvailTotal * 100).toFixed(2)) : 0;

  const yrArrivals = allMonths.reduce((sum, m) => {
    const md = m.residentsByDay[0] || {};
    return sum + (md.philippine_resident_filipino || 0) + (md.philippine_resident_foreign || 0) +
           (md.listed_foreign_resident || 0) + (md.unlisted_foreign_resident || 0) + 
           (md.unspecified_guest || 0) + (md.overseas_filipino || 0);
  }, 0);
  const yrNights = allMonths.reduce((sum, m) => sum + m.guestNights, 0);
  sheet.getCell(r.alos, 14).value = yrArrivals > 0 ? parseFloat((yrNights / yrArrivals).toFixed(2)) : 0;


  // ── Sex breakdown ────────────────────────────────────────────────────────────
  // FIX: corrected offsets (+0 to +4) to ensure data aligns with labels in template
  const setMonthlySexValues = (rowStart, gender) => {
    setMonthValues(rowStart + 1, m => mSex(m, gender, 'philippine_resident_filipino') + mSex(m, gender, 'philippine_resident_foreign'));
    // b. Non-Philippine/Foreign Residents (including unspecified)
    setMonthValues(rowStart + 2, m => mSex(m, gender, 'listed_foreign_resident') + mSex(m, gender, 'unlisted_foreign_resident') + mSex(m, gender, 'unspecified_guest'));
    setMonthValues(rowStart + 3, m => mSex(m, gender, 'overseas_filipino'));
    // d. Others/Unspecified Guest
    setMonthValues(rowStart + 4, m => mSex(m, gender, 'unlisted_foreign_resident') + mSex(m, gender, 'unspecified_guest'));
    // TOTAL per sex
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
//
// breakRows = row numbers (1-based, from ExcelJS) where a NEW PAGE begins
//             BEFORE that row is rendered.
//
// Spreadsheet 1 & 3 — Daily / Monthly  →  landscape A3, 3 pages:
//   page 1 : rows 1-32   (header, accommodation checkboxes, PH residents)
//   page 2 : rows 33-90  (COUNTRY OF RESIDENCE — first half)   ← adjust if off
//   page 3 : rows 91+    (COUNTRY OF RESIDENCE — second half)  ← adjust if off
//
// Spreadsheet 2 — Sum                  →  portrait  A3, 3 pages:
//   page 1 : rows 1-65   (header … BAHRAIN)
//   page 2 : rows 66-127 (EGYPT → before NEW ZEALAND)
//   page 3 : rows 128+   (NEW ZEALAND onward)
//
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

// ─── PDF Generation ──────────────────────────────────────────────────────────

async function _generatePdfFromWorkbook(workbook, pdfPath, month, year) {
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
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

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

    // Collect all rows (capped at 197)
    const rows = [];
    sheet.eachRow({ includeEmpty: true }, (row, rn) => {
      if (rn > 197) return;
      rows.push({ row, rn });
    });

    // Build sections from break-row boundaries
    const breaks = [1, ...cfg.breakRows, Infinity];

    // Pre-compute all sections and find the tallest one
    const sheetSections = [];
    for (let s = 0; s < breaks.length - 1; s++) {
      const lo = breaks[s];
      const hi = breaks[s + 1];
      const section = rows.filter(r => r.rn >= lo && r.rn < hi);
      if (section.length > 0) sheetSections.push(section);
    }

    // Measure total width (identical for all sections)
    let totalW = 0;
    for (let c = 1; c <= 33; c++) {
      const w = sheet.getColumn(c).width;
      if (w != null && w > 0) totalW += w;
    }
    if (totalW === 0) totalW = 40;

    // Find tallest section height for vertical constraint
    let maxSectionH = 0;
    for (const sec of sheetSections) {
      let h = 0;
      for (const { row } of sec) h += row.height || 15;
      if (h > maxSectionH) maxSectionH = h;
    }
    if (maxSectionH === 0) maxSectionH = 300;
    const contentH = maxSectionH * (cfg.heightFactor ?? BASE_HEIGHT_FACTOR);

    // Balance width and height: compute a widthFactor that equalises both constraints
    const balancedWF = aw * contentH / (totalW * ah);
    const wf = Math.min(balancedWF, BASE_WIDTH_FACTOR);
    const contentW = totalW * wf;

    // Single uniform scale — fits both dimensions (constraints are now balanced)
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

      // ── Render ─────────────────────────────────────────────────────────────
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

          // Fill
          if (cell.fill?.fgColor?.argb) {
            doc.rect(curX, curY, bw, bh)
               .fill('#' + cell.fill.fgColor.argb.substring(2));
          }

          // Borders
          if (cell.border) {
            doc.lineWidth(0.5).strokeColor('#000000');
            if (cell.border.top)    doc.moveTo(curX, curY).lineTo(curX + bw, curY).stroke();
            if (cell.border.bottom) doc.moveTo(curX, curY + bh).lineTo(curX + bw, curY + bh).stroke();
            if (cell.border.left)   doc.moveTo(curX, curY).lineTo(curX, curY + bh).stroke();
            if (cell.border.right)  doc.moveTo(curX + bw, curY).lineTo(curX + bw, curY + bh).stroke();
          }

          // Text
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

          if (text === '✔') {
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