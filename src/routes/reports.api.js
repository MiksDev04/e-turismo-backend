import express from 'express';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { promises as fsp } from 'fs';
import db from '../config/db.js';
import auth from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const adminGuard = [auth.authenticate, auth.requireRole('admin')];

// ─── Template default font extraction ────────────────────────────────────────
// ExcelJS always writes Calibri as the workbook default (zero) font, but column
// widths are stored in "characters of the default font".  The templates use
// MS PGothic (VAR) / Arial (DAE), so a Calibri default makes the same stored
// width render ~9% narrower.  We capture each template's default font here so
// exports can be patched back to render identically to the template.

async function _readTemplateDefaultFont(filePath) {
  const zip = await JSZip.loadAsync(await fsp.readFile(filePath));
  const styles = await zip.file('xl/styles.xml').async('string');
  const match = styles.match(/(<fonts[^>]*>)(<font>[\s\S]*?<\/font>)/);
  return match ? match[2] : null;
}

// ─── Load template workbook for styled Excel exports ─────────────────────────
const defaultFontXml = { var: null, dae: null, attraction: null };

let templateWb = null;
try {
  templateWb = new ExcelJS.Workbook();
  await templateWb.xlsx.readFile(path.join(__dirname, '..', '..', 'sample', 'ON Blank Form.xlsx'));
  defaultFontXml.dae = await _readTemplateDefaultFont(path.join(__dirname, '..', '..', 'sample', 'ON Blank Form.xlsx'));
  console.log('[report] DAE Template loaded successfully');
} catch (err) {
  console.warn('[report] DAE Template not found, exports will be unformatted:', err.message);
  templateWb = null;
}

let varTemplateWb = null;
try {
  varTemplateWb = new ExcelJS.Workbook();
  await varTemplateWb.xlsx.readFile(path.join(__dirname, '..', '..', 'sample', 'VAR-REPORT.xlsx'));
  defaultFontXml.var = await _readTemplateDefaultFont(path.join(__dirname, '..', '..', 'sample', 'VAR-REPORT.xlsx'));
  console.log('[report] VAR Template loaded successfully');
} catch (err) {
  console.warn('[report] VAR Template not found, VAR exports will be unformatted:', err.message);
  varTemplateWb = null;
}

// ─── Load the tourism office logo for the VAR header ─────────────────────────
let varLogoBuffer = null;
try {
  varLogoBuffer = await fsp.readFile(path.join(__dirname, '..', '..', 'sample', 'tourism_office_logo.jpg'));
  console.log('[report] VAR logo loaded');
} catch (err) {
  console.warn('[report] VAR logo not found, VAR exports will have no logo:', err.message);
}

// ─── VAR 1 (Tourist Attraction) template ─────────────────────────────────────
let attractionTemplateWb = null;
try {
  attractionTemplateWb = new ExcelJS.Workbook();
  await attractionTemplateWb.xlsx.readFile(path.join(__dirname, '..', '..', 'sample', 'same day blank.xlsx'));
  defaultFontXml.attraction = await _readTemplateDefaultFont(path.join(__dirname, '..', '..', 'sample', 'same day blank.xlsx'));
  console.log('[report] VAR 1 (Attraction) Template loaded successfully');
} catch (err) {
  console.warn('[report] VAR 1 Template not found, attraction exports will be unformatted:', err.message);
  attractionTemplateWb = null;
}

// ─── VAR 1 template images (top logo + footer graphic) ───────────────────────
// The blank already carries its own artwork, so exports must reproduce it
// rather than re-injecting a separate logo.  The anchors (twoCell) are parsed
// from the template's drawing XML; the media bytes come from the canonical
// sample files (tourism office logo on top, QR graphic at the bottom) so both
// the Excel and PDF exports render the official artwork at the exact spots
// where the blank template places its images.
const attractionTemplateImages = [];

// Two-cell anchor offsets lifted from "same day blank.xlsx" drawing1.xml.
// ExcelJS zeroes out colOff/rowOff when it serializes image anchors, so the
// exported drawing XML must be patched back to these exact EMU offsets to put
// the logo + QR on the same spot as the blank template.
const kVar1ImageAnchors = [
  {
    name: 'logo',
    fromCol: 2, fromRow: 2, toCol: 4, toRow: 6,
    fromColOff: 470148, fromRowOff: 149413,
    toColOff: 562783, toRowOff: 186853,
  },
  {
    name: 'qr',
    fromCol: 1, fromRow: 61, toCol: 5, toRow: 63,
    fromColOff: 449482, fromRowOff: 237814,
    toColOff: 90894, toRowOff: 255295,
  },
];

async function _loadAttractionTemplateImages() {
  try {
    const filePath = path.join(__dirname, '..', '..', 'sample', 'same day blank.xlsx');
    const zip = await JSZip.loadAsync(await fsp.readFile(filePath));

    const drawingXml = await zip.file('xl/drawings/drawing1.xml').async('string');

    // Split the drawing XML into per-anchor blocks, keeping only the ones that
    // actually embed a picture.
    const anchorBlocks = drawingXml
      .split(/<xdr:twoCellAnchor>|<xdr:oneCellAnchor>/)
      .slice(1)
      .filter(block => /r:embed="/.test(block));

    // Parse each block's two-cell anchor (top-left + bottom-right corners).
    const anchors = anchorBlocks.map(block => {
      const getVal = (tag, nth) => {
        const all = [...block.matchAll(new RegExp(`<xdr:${tag}>\\s*(\\d+)\\s*</xdr:${tag}>`, 'g'))];
        const m = all[nth];
        return m ? parseInt(m[1], 10) : 0;
      };
      const getOff = (tag, nth) => {
        const all = [...block.matchAll(new RegExp(`<xdr:${tag}>\\s*(\\d+)\\s*</xdr:${tag}>`, 'g'))];
        const m = all[nth];
        return m ? parseInt(m[1], 10) : 0;
      };
      return {
        tl: { col: getVal('col', 0), colOff: getOff('colOff', 0), row: getVal('row', 0), rowOff: getOff('rowOff', 0) },
        br: { col: getVal('col', 1), colOff: getOff('colOff', 1), row: getVal('row', 1), rowOff: getOff('rowOff', 1) },
      };
    });

    if (anchors.length === 0) return;

    // Sort by starting row so [0] = top (logo) and [last] = bottom (QR).
    anchors.sort((a, b) => a.tl.row - b.tl.row);
    const logo = anchors[0];
    const qr = anchors[anchors.length - 1];

    const logoPath = path.join(__dirname, '..', '..', 'sample', 'tourism_office_logo.jpg');
    const qrPath = path.join(__dirname, '..', '..', 'sample', 'qr-pic.png');

    const [logoBuffer, qrBuffer] = await Promise.all([
      fsp.readFile(logoPath),
      fsp.readFile(qrPath),
    ]);

    attractionTemplateImages.push(
      { buffer: logoBuffer, extension: 'jpeg', tl: logo.tl, br: logo.br },
      { buffer: qrBuffer, extension: 'png', tl: qr.tl, br: qr.br },
    );
    console.log(`[report] VAR 1 template images loaded (${attractionTemplateImages.length})`);
  } catch (err) {
    console.warn('[report] VAR 1 template images not found:', err.message);
  }
}

await _loadAttractionTemplateImages();

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

// ─── Daily Sheet Formula Mappings ────────────────────────────────────────────
// Subtotal rows: each day column gets a SUM formula referencing component rows.
const kDailySubtotalFormulas = {
  30: { start: 28, end: 29 },    // PH Res Total
  45: { start: 36, end: 44 },    // ASEAN
  53: { start: 48, end: 52 },    // East Asia
  62: { start: 56, end: 61 },    // South Asia
  73: { start: 66, end: 72 },    // Middle East
  80: { start: 77, end: 79 },    // North America
  88: { start: 83, end: 87 },    // South America
  99: { start: 92, end: 98 },    // Western Europe
  108: { start: 102, end: 107 }, // Northern Europe
  116: { start: 111, end: 115 }, // Southern Europe
  122: { start: 119, end: 121 }, // Eastern Europe
  131: { start: 126, end: 130 }, // Australasia
  136: { start: 134, end: 135 }, // Africa
};
// Special rows: each day column gets an additive formula referencing specific rows.
const kDailySpecialFormulas = {
  141: [139, 136, 131, 122, 116, 108, 99, 88, 80, 73, 62, 53, 45], // Total Foreign
  145: [143, 141, 30, 149],   // Grand Total
  146: [30],                    // Summary PH Total (alias)
  147: [141],                   // Summary Foreign Total (alias)
  148: [143],                   // Summary Overseas Total (alias)
};

// ─── Monthly Sheet Formula Mappings ──────────────────────────────────────────
const kMonthlySubtotalFormulas = {
  30: { start: 28, end: 29 },
  45: { start: 36, end: 44 },
  53: { start: 48, end: 52 },
  62: { start: 56, end: 61 },
  72: { start: 65, end: 71 },
  80: { start: 77, end: 79 },
  88: { start: 83, end: 87 },
  99: { start: 92, end: 98 },
  108: { start: 102, end: 107 },
  116: { start: 111, end: 115 },
  122: { start: 119, end: 121 },
  130: { start: 125, end: 129 },
  137: { start: 135, end: 136 },
};
const kMonthlySpecialFormulas = {
  142: [140, 137, 130, 122, 116, 108, 99, 88, 80, 72, 62, 53, 45],
  147: [30],
  148: [142],
  149: [144],
};
const kMonthlyRangeFormulas = {
  146: { start: 147, end: 149 }, // Grand Total = SUM(B147:B149)
};

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

function _normalizeCityName(name) {
  return (name || '')
    .toUpperCase()
    .replace(/^CITY\s+OF\s+/, '')
    .replace(/^MUNICIPALITY\s+OF\s+/, '')
    .replace(/\s+CITY$/, '')
    .replace(/\s+MUNICIPALITY$/, '')
    .trim();
}

// Parse date strings as LOCAL time to prevent UTC-midnight shifting dates by
// -1 day in Philippine timezone (UTC+8).
function _parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const datePart = String(dateStr).split('T')[0].split(' ')[0];
  const [y, mo, d] = datePart.split('-').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d); // local midnight — getDate() is always correct
}

function _colLetter(colNum) {
  let result = '';
  let n = colNum;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
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

// ─── Formula Evaluator for PDF rendering ──────────────────────────────────────
// ExcelJS does not compute formula results.  The xlsx writer stores the formula
// string so Excel can compute on open, but the PDF renderer needs a cached
// result.  This evaluator handles the three simple formula patterns used in
// this codebase:  SUM(range), AVERAGE(range), and cellRef+cellRef+…

function _colLetterToNum(letter) {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result;
}

function _parseCellRef(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { col: _colLetterToNum(m[1]), row: parseInt(m[2], 10) };
}

function _parseRange(range) {
  const [start, end] = range.split(':');
  const s = _parseCellRef(start);
  const e = _parseCellRef(end);
  if (!s || !e) return [];
  const cells = [];
  for (let r = s.row; r <= e.row; r++) {
    for (let c = s.col; c <= e.col; c++) {
      cells.push({ row: r, col: c });
    }
  }
  return cells;
}

function _evaluateFormulasInSheet(sheet) {
  function _ensureEvaluated(row, col) {
    const cell = sheet.getCell(row, col);
    if (!cell.value || typeof cell.value !== 'object') return;
    if (!cell.value.formula) return;
    if (cell.value.result !== undefined && cell.value.result !== null) return;
    _evaluateCell(cell);
  }

  function _cellNum(row, col) {
    _ensureEvaluated(row, col);
    const v = sheet.getCell(row, col).value;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'object') {
      if (v.result !== undefined && v.result !== null) return Number(v.result) || 0;
    }
    return Number(v) || 0;
  }

  function _evaluateCell(cell) {
    const formula = cell.value.formula;
    let result = 0;

    const sumMatch = formula.match(/^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
    const avgMatch = formula.match(/^AVERAGE\(([A-Z]+\d+):([A-Z]+\d+)\)$/);

    if (sumMatch) {
      const cells = _parseRange(`${sumMatch[1]}:${sumMatch[2]}`);
      result = cells.reduce((s, rc) => s + _cellNum(rc.row, rc.col), 0);
    } else if (avgMatch) {
      const cells = _parseRange(`${avgMatch[1]}:${avgMatch[2]}`);
      const vals = cells.map(rc => _cellNum(rc.row, rc.col));
      result = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    } else {
      // cellRef+cellRef+…  (addition only)
      const parts = formula.split('+');
      result = parts.reduce((s, p) => {
        const ref = _parseCellRef(p.trim());
        return s + (ref ? _cellNum(ref.row, ref.col) : 0);
      }, 0);
    }

    cell.value = { formula, result };
  }

  sheet.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (cell.value && typeof cell.value === 'object' && cell.value.formula
          && (cell.value.result === undefined || cell.value.result === null)) {
        _evaluateCell(cell);
      }
    });
  });
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

    if (!['dae', 'var1', 'var2'].includes(reportType)) {
      return res.status(400).json({ message: 'reportType must be "dae", "var1", or "var2"' });
    }

    if (reportType === 'dae') {
      if (!reportVariant || !['daily', 'summary', 'series'].includes(reportVariant)) {
        return res.status(400).json({ message: 'reportVariant must be "daily", "summary", or "series" (DAE)' });
      }
    } else if (reportType === 'var2') {
      if (reportVariant && reportVariant !== 'total') {
        return res.status(400).json({ message: 'VAR 2 reportVariant must be "total"' });
      }
    } else {
      if (reportVariant && reportVariant !== 'daily') {
        return res.status(400).json({ message: 'VAR 1 reportVariant must be "daily"' });
      }
    }

    const effectiveVariant = reportType === 'var2' ? 'total' : reportType === 'var1' ? 'daily' : reportVariant;

    if (!periodYear || parseInt(periodYear, 10) < 2000) {
      return res.status(400).json({ message: 'periodYear must be >= 2000' });
    }
    if (!Array.isArray(periodMonths) || periodMonths.length === 0) {
      return res.status(400).json({ message: 'periodMonths must be a non-empty array of month ints (1-12)' });
    }

    const months = [...new Set(periodMonths)].map(Number).filter(m => m >= 1 && m <= 12).sort((a, b) => a - b);

    if (['daily', 'summary'].includes(effectiveVariant) && months.length !== 1) {
      return res.status(400).json({ message: `"${effectiveVariant}" variant requires exactly one month` });
    }

    // Find-or-create (atomic: INSERT IGNORE + SELECT)
    const newBatchId = uuidv4();
    await db.pool.execute(
      `INSERT IGNORE INTO report_batches (id, report_type, report_variant, period_year, period_months, requested_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newBatchId, reportType, effectiveVariant, parseInt(periodYear, 10), JSON.stringify(months), req.user.id]
    );
    const [rows] = await db.pool.execute(
      `SELECT id FROM report_batches
       WHERE report_type = ? AND report_variant = ? AND period_year = ? AND period_months = CAST(? AS JSON)`,
      [reportType, effectiveVariant, parseInt(periodYear, 10), JSON.stringify(months)]
    );
    const isExisting = rows[0].id !== newBatchId;
    res.status(200).json({ batchId: rows[0].id, existing: isExisting });
  } catch (err) {
    next(err);
  }
});

// ── View report (live aggregation, returns JSON) ───────────────────────────
router.get('/reports/view', adminGuard, async (req, res, next) => {
  try {
    const { reportType = 'dae', reportVariant, periodYear, periodMonths } = req.query;

    if (!['dae', 'var1', 'var2'].includes(reportType)) {
      return res.status(400).json({ message: 'reportType must be "dae", "var1", or "var2"' });
    }

    let effectiveVariant;
    if (reportType === 'dae') {
      if (!reportVariant || !['daily', 'summary', 'series'].includes(reportVariant)) {
        return res.status(400).json({ message: 'reportVariant is required (daily|summary|series)' });
      }
      effectiveVariant = reportVariant;
    } else if (reportType === 'var2') {
      effectiveVariant = 'total';
    } else {
      effectiveVariant = 'daily';
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

    if (['daily', 'summary'].includes(effectiveVariant) && sortedMonths.length !== 1) {
      return res.status(400).json({ message: `"${effectiveVariant}" requires exactly one month` });
    }

    const year = parseInt(periodYear, 10);

    // Find-or-create batch (atomic: INSERT IGNORE + SELECT)
    const newBatchId = uuidv4();
    await db.pool.execute(
      `INSERT IGNORE INTO report_batches (id, report_type, report_variant, period_year, period_months, requested_by, last_viewed_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [newBatchId, reportType, effectiveVariant, year, JSON.stringify(sortedMonths), req.user.id]
    );
    const [rows] = await db.pool.execute(
      `SELECT id FROM report_batches
       WHERE report_type = ? AND report_variant = ? AND period_year = ? AND period_months = CAST(? AS JSON)`,
      [reportType, effectiveVariant, year, JSON.stringify(sortedMonths)]
    );
    const batchId = rows[0].id;
    await db.pool.execute('UPDATE report_batches SET last_viewed_at = NOW() WHERE id = ?', [batchId]);

    // Fetch approved businesses
    const [businesses] = await db.pool.execute(
      `SELECT id, business_name, business_line, ae_id, region, city_municipality, province,
              (SELECT COUNT(*) FROM rooms WHERE business_id = businesses.id) AS total_rooms
       FROM businesses WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY business_name`
    );

    // Aggregate per business
    const establishments = [];
    const allMonthData = [];

    if (reportType === 'var2') {
      // VAR 2: combined tourist-attraction + accommodation aggregate, one row each.
      // Fetch per-establishment sex × residence aggregates, then append one row
      // per approved tourist attraction using its month totals.
      let totalsVar = {
        maleThisCity: 0, femaleThisCity: 0,
        maleOtherCity: 0, femaleOtherCity: 0,
        maleOtherProvince: 0, femaleOtherProvince: 0,
        maleForeign: 0, femaleForeign: 0,
      };

      const accumulate = (vd) => {
        for (const k of Object.keys(totalsVar)) totalsVar[k] += vd[k] || 0;
      };

      for (const biz of businesses) {
        const varDataList = await Promise.all(
          sortedMonths.map(m => _fetchVarMonthData(biz.id, biz.city_municipality, biz.province, m, year))
        );

        const varData = {
          maleThisCity: 0, femaleThisCity: 0,
          maleOtherCity: 0, femaleOtherCity: 0,
          maleOtherProvince: 0, femaleOtherProvince: 0,
          maleForeign: 0, femaleForeign: 0,
        };
        for (const vd of varDataList) {
          for (const k of Object.keys(varData)) varData[k] += vd[k];
        }

        accumulate(varData);

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
          monthData: null,
          seriesData: null,
          varData,
        });
      }

      // Append approved tourist attractions as one row per attraction.
      const [attractions] = await db.pool.execute(
        `SELECT id, attraction_name, attraction_type, barangay
         FROM tourist_attractions
         WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY attraction_name`
      );

      for (const att of attractions) {
        const attDataList = await Promise.all(
          sortedMonths.map(m => _fetchAttractionMonthData(att.id, m, year))
        );
        const varData = {
          maleThisCity: 0, femaleThisCity: 0,
          maleOtherCity: 0, femaleOtherCity: 0,
          maleOtherProvince: 0, femaleOtherProvince: 0,
          maleForeign: 0, femaleForeign: 0,
        };
        for (const ad of attDataList) {
          for (const k of Object.keys(varData)) varData[k] += ad.totals[k] || 0;
        }

        accumulate(varData);

        establishments.push({
          businessId: String(att.id),
          businessName: att.attraction_name,
          totalRooms: 0,
          aeId: null,
          region: null,
          cityMunicipality: 'San Pablo City',
          province: 'Laguna',
          businessLine: [],
          attractionType: typeof att.attraction_type === 'string'
            ? JSON.parse(att.attraction_type || '[]')
            : (att.attraction_type || []),
          barangay: att.barangay,
          monthData: null,
          seriesData: null,
          varData,
        });
      }

      res.json({
        batch: { id: batchId, reportType, reportVariant: effectiveVariant, periodYear: year, periodMonths: sortedMonths },
        establishments,
        totals: totalsVar,
      });
    } else if (reportType === 'var1') {
      // VAR 1: one daily sex × residence grid per approved tourist attraction
      const [attractions] = await db.pool.execute(
        `SELECT id, attraction_name, attraction_type, barangay
         FROM tourist_attractions
         WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY attraction_name`
      );

      const totalsVar = {
        maleThisCity: 0, femaleThisCity: 0,
        maleOtherCity: 0, femaleOtherCity: 0,
        maleOtherProvince: 0, femaleOtherProvince: 0,
        maleForeign: 0, femaleForeign: 0,
      };
      const establishments = [];

      for (const att of attractions) {
        const md = await _fetchAttractionMonthData(att.id, sortedMonths[0], year);
        establishments.push({
          businessId: String(att.id),
          businessName: att.attraction_name,
          totalRooms: 0,
          aeId: null,
          region: null,
          cityMunicipality: 'San Pablo City',
          province: 'Laguna',
          businessLine: [],
          attractionType: typeof att.attraction_type === 'string'
            ? JSON.parse(att.attraction_type || '[]')
            : (att.attraction_type || []),
          barangay: att.barangay,
          monthData: null,
          seriesData: null,
          varData: null,
          attractionDaily: md.daily,
          attractionTotals: md.totals,
        });
        for (const k of Object.keys(md.totals)) totalsVar[k] += md.totals[k];
      }

      res.json({
        batch: { id: batchId, reportType, reportVariant: effectiveVariant, periodYear: year, periodMonths: sortedMonths },
        establishments,
        totals: totalsVar,
      });
    } else {
      // DAE: existing logic
      for (const biz of businesses) {
        const monthDataList = await Promise.all(
          sortedMonths.map(m => _fetchMonthData(biz.id, m, year))
        );
        allMonthData.push(...monthDataList);

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
    }
  } catch (err) {
    next(err);
  }
});

// ── Download report (generates file in memory, streams bytes) ───────────────
router.post('/reports/download', adminGuard, async (req, res, next) => {
  // TODO: large annual series across many establishments may be slow on free tier
  try {
    const { reportType = 'dae', reportVariant, periodYear, periodMonths, format = 'xlsx', pageWidth, pageHeight } = req.body;

    if (!['dae', 'var1', 'var2'].includes(reportType)) {
      return res.status(400).json({ message: 'reportType must be "dae", "var1", or "var2"' });
    }

    let effectiveVariant;
    if (reportType === 'dae') {
      if (!reportVariant || !['daily', 'summary', 'series'].includes(reportVariant)) {
        return res.status(400).json({ message: 'reportVariant must be "daily", "summary", or "series"' });
      }
      effectiveVariant = reportVariant;
    } else if (reportType === 'var2') {
      effectiveVariant = 'total';
    } else {
      effectiveVariant = 'daily';
    }

    if (!periodYear) {
      return res.status(400).json({ message: 'periodYear is required' });
    }
    if (!['xlsx', 'pdf'].includes(format)) {
      return res.status(400).json({ message: 'format must be "xlsx" or "pdf"' });
    }

    let months;
    if (Array.isArray(periodMonths)) {
      months = periodMonths;
    } else {
      try {
        months = JSON.parse(periodMonths);
        if (!Array.isArray(months)) throw new Error();
      } catch {
        return res.status(400).json({ message: 'periodMonths must be a JSON array of ints' });
      }
    }

    const sortedMonths = [...months].map(Number).sort((a, b) => a - b);

    if (['daily', 'summary'].includes(effectiveVariant) && sortedMonths.length !== 1) {
      return res.status(400).json({ message: `"${effectiveVariant}" requires exactly one month` });
    }

    const year = parseInt(periodYear, 10);

    // Find-or-create batch (atomic: INSERT IGNORE + SELECT)
    const newBatchId = uuidv4();
    await db.pool.execute(
      `INSERT IGNORE INTO report_batches (id, report_type, report_variant, period_year, period_months, requested_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newBatchId, reportType, effectiveVariant, year, JSON.stringify(sortedMonths), req.user.id]
    );
    const [dlRows] = await db.pool.execute(
      `SELECT id FROM report_batches
       WHERE report_type = ? AND report_variant = ? AND period_year = ? AND period_months = CAST(? AS JSON)`,
      [reportType, effectiveVariant, year, JSON.stringify(sortedMonths)]
    );
    const batchId = dlRows[0].id;

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
    const monthLabel = sortedMonths.length === 1
      ? String(sortedMonths[0]).padStart(2, '0')
      : sortedMonths.length === 12 ? 'FULL' : sortedMonths.join('-');

    // ── Build workbooks ───────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();

    if (reportType === 'var2') {
      // ── VAR 2: Single worksheet with all accommodations + attractions ─────
      const varTmpl = varTemplateWb?.getWorksheet('VAR 2M LGU Month Report');
      const sheetName = 'VAR Report';
      const sheet = varTmpl
        ? _cloneSheetFromTemplate(varTmpl, sheetName, wb)
        : wb.addWorksheet(sheetName);

      // Fetch var data for each business across all requested months
      const varRows = [];
      const varDataList = [];
      for (const biz of businesses) {
        const monthlyData = await Promise.all(
          sortedMonths.map(m => _fetchVarMonthData(biz.id, biz.city_municipality, biz.province, m, year))
        );
        // Aggregate across months
        const aggregated = {
          maleThisCity: 0, femaleThisCity: 0,
          maleOtherCity: 0, femaleOtherCity: 0,
          maleOtherProvince: 0, femaleOtherProvince: 0,
          maleForeign: 0, femaleForeign: 0,
        };
        for (const md of monthlyData) {
          for (const k of Object.keys(aggregated)) aggregated[k] += md[k] || 0;
        }
        varRows.push({
          business_name: biz.business_name,
          city_municipality: biz.city_municipality,
          attrCode: '9-902',
        });
        varDataList.push(aggregated);
      }

      // Append approved tourist attractions as one row each (attr code 1-103)
      const [attractions] = await db.pool.execute(
        `SELECT id, attraction_name
         FROM tourist_attractions
         WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY attraction_name`
      );

      for (const att of attractions) {
        const monthlyData = await Promise.all(
          sortedMonths.map(m => _fetchAttractionMonthData(att.id, m, year))
        );
        const aggregated = {
          maleThisCity: 0, femaleThisCity: 0,
          maleOtherCity: 0, femaleOtherCity: 0,
          maleOtherProvince: 0, femaleOtherProvince: 0,
          maleForeign: 0, femaleForeign: 0,
        };
        for (const md of monthlyData) {
          for (const k of Object.keys(aggregated)) aggregated[k] += md.totals[k] || 0;
        }
        varRows.push({
          business_name: att.attraction_name,
          city_municipality: 'San Pablo City',
          attrCode: '1-103',
        });
        varDataList.push(aggregated);
      }

      if (varRows.length > kVarTotalRow - kVarDataRowStart) {
        console.warn(`[report] VAR 2 combined rows (${varRows.length}) exceed the template's data rows (${kVarTotalRow - kVarDataRowStart}); trailing rows will be dropped.`);
      }

      _buildVarExcelSheet(sheet, varRows, varDataList, sortedMonths, year);

      // Embed the tourism office logo in the header (mirrors the template's
      // B1 anchor spanning rows 1-4).
      if (varLogoBuffer) {
        try {
          const logoId = wb.addImage({ buffer: varLogoBuffer, extension: 'jpeg' });
          sheet.addImage(logoId, {
            tl: { nativeCol: 1, nativeColOff: 1038225, nativeRow: 0, nativeRowOff: 57150 },
            ext: { width: 64, height: 64 },
          });
        } catch (err) {
          console.warn('[report] Could not embed VAR logo:', err.message);
        }
      }
    } else if (reportType === 'var1') {
      // ── VAR 1: Per-attraction worksheets (daily sex × residence grid) ──────
      const [attractions] = await db.pool.execute(
        `SELECT id, attraction_name, attraction_type
         FROM tourist_attractions
         WHERE status IN ('approved', 'warning') AND deleted_at IS NULL ORDER BY attraction_name`
      );

      const attractionTmpl = attractionTemplateWb?.getWorksheet('Sheet1');

      for (const att of attractions) {
        const md = await _fetchAttractionMonthData(att.id, sortedMonths[0], year);
        const sheetName = att.attraction_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
        const sheet = attractionTmpl
          ? _cloneSheetFromTemplate(attractionTmpl, sheetName, wb)
          : wb.addWorksheet(sheetName);

        const attractionType = typeof att.attraction_type === 'string'
          ? JSON.parse(att.attraction_type || '[]')
          : (att.attraction_type || []);
        _buildVar1ExcelSheet(sheet, att.attraction_name, attractionType, md.daily, md.totals,
          sortedMonths[0], year);

        // Restore the template's own artwork (top logo + footer graphic) into
        // the cloned sheet — the clone strips images, so they must be re-added
        // with their original two-cell anchors.
        for (const img of attractionTemplateImages) {
          try {
            const imageId = wb.addImage({ buffer: img.buffer, extension: img.extension });
            sheet.addImage(imageId, { tl: img.tl, br: img.br });
          } catch (err) {
            console.warn('[report] Could not restore VAR 1 template image:', err.message);
          }
        }
      }
    } else {
      // ── DAE: Per-establishment worksheets ──────────────────────────────────
      for (const biz of businesses) {
        let bizAllMonths = null;
        if (reportVariant === 'series' && sortedMonths.length > 1) {
          bizAllMonths = await Promise.all(
            sortedMonths.map(m => _fetchMonthData(biz.id, m, year))
          );
        } else if (sortedMonths.length === 1) {
          const md = await _fetchMonthData(biz.id, sortedMonths[0], year);
          bizAllMonths = [md];
        }

        if (reportVariant === 'daily' && bizAllMonths?.[0]) {
          const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
          const tmpl = templateWb?.getWorksheet('Name of Establishment');
          const sheet = tmpl ? _cloneSheetFromTemplate(tmpl, sheetName, wb) : wb.addWorksheet(sheetName);
          _buildDailySheet(sheet, biz, bizAllMonths[0], sortedMonths[0], year, daysInMonth, adminName);
        }

        if (reportVariant === 'summary' && bizAllMonths?.[0]) {
          const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
          const tmpl = templateWb?.getWorksheet('AE DAE-1B by Country (Sum) ');
          const sheet = tmpl ? _cloneSheetFromTemplate(tmpl, sheetName, wb) : wb.addWorksheet(sheetName);
          _buildCountrySummarySheet(sheet, bizAllMonths[0], biz.total_rooms, sortedMonths[0], year,
            daysInMonth, adminName, biz.city_municipality || '', biz.province || '', biz.business_name, biz);
        }

        if (reportVariant === 'series' && bizAllMonths && bizAllMonths.length > 1) {
          const sheetName = biz.business_name.substring(0, 31).replace(/[\\\?\*\/\[\]]/g, '');
          const tmpl = templateWb?.getWorksheet('AE DAE-1B (Monthly)');
          const sheet = tmpl ? _cloneSheetFromTemplate(tmpl, sheetName, wb) : wb.addWorksheet(sheetName);
          _buildMonthlySummarySheet(sheet, bizAllMonths, biz.total_rooms, year, adminName,
            biz.city_municipality || '', biz.province || '', biz.business_name, biz);
        }
      }
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
    const _abbr = ['', 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _fmtPeriod = (ms) => {
      if (ms.length === 12) return 'Jan-Dec';
      if (ms.length === 1) return _abbr[ms[0]];
      return `${_abbr[ms[0]]}-${_abbr[ms[ms.length - 1]]}`;
    };
    const baseFilename = `${reportType.toUpperCase()}_${reportVariant}_${_fmtPeriod(sortedMonths)}_${year}`;

    if (format === 'xlsx') {
      // Evaluate all formulas so the exported file carries cached results
      // (viewers that don't recalculate show 0 in totals/subtotals otherwise).
      wb.eachSheet(sheet => _evaluateFormulasInSheet(sheet));
      wb.calcProperties.fullCalcOnLoad = true;
      const buffer = await wb.xlsx.writeBuffer();
      const fontXml = reportType === 'var2' ? defaultFontXml.var
        : reportType === 'var1' ? defaultFontXml.attraction
        : defaultFontXml.dae;
      let outBuffer = fontXml ? await _patchDefaultFont(buffer, fontXml) : buffer;
      if (reportType === 'var1') {
        outBuffer = await _patchVar1ImageOffsets(outBuffer);
      }
      await db.pool.execute('UPDATE report_batches SET last_generated_at = NOW() WHERE id = ?', [batchId]);
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="${baseFilename}.xlsx"`);
      res.send(Buffer.from(outBuffer));
    } else {
      // Evaluate all formulas so the PDF renderer can read cached results
      wb.eachSheet(sheet => _evaluateFormulasInSheet(sheet));
      const pdfBuffer = await _generatePdfBuffer(wb, effectiveVariant, sortedMonths[0], year, reportType, { pageWidth, pageHeight });
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

async function _fetchMonthData(businessId, month, year) {
  const firstDay    = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay     = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;
  const statusFilter = "AND status IN ('active', 'archived')";

  // Fetch records that have ANY presence in the month (not just check_in).
  // This catches cross-month stays: check_in before the month but check_out after it starts,
  // or check_in within the month but check_out after it ends.
  const [records] = await db.pool.execute(
    `SELECT id, check_in, check_out, actual_check_out, total_guests,
            lead_country, lead_sex, lead_nationality, lead_is_overseas,
            male_count, female_count
     FROM guest_records
     WHERE business_id = ? AND is_deleted = false
       AND COALESCE(actual_check_out, check_out) >= ? AND check_in <= ? ${statusFilter}`,
    [businessId, firstDay, lastDay]
  );

  // Fetch room assignment windows to compute rooms_occupied per record per day.
  // Each room link carries its own active window (created_at → deleted_at) so a
  // room removed mid-stay is only counted for the days it was actually occupied.
  const recordIds = records.map(r => r.id);
  let roomWindows = {};
  if (recordIds.length > 0) {
    const [grrRows] = await db.pool.execute(
      `SELECT guest_record_id, room_id,
              DATE(created_at) AS start_date,
              DATE(deleted_at)  AS end_date
       FROM guest_record_rooms
       WHERE guest_record_id IN (${recordIds.map(() => '?').join(',')})`,
      recordIds
    );
    grrRows.forEach(r => {
      if (!roomWindows[r.guest_record_id]) roomWindows[r.guest_record_id] = [];
      roomWindows[r.guest_record_id].push({ startDate: r.start_date, endDate: r.end_date });
    });
  }

  const countryByDay            = {};
  const residentsByDay          = { 0: {} };
  const sexByDay                = { 0: { male: {}, female: {} } };
  const roomsOccupiedByDay      = {};
  const guestNightsByDay        = {};
  const guestNightsPerArrivalDay = {};
  let totalGuestNights = 0;

  const listedSet = new Set(kCountryRows.map(c => c.country));

  // ── Spread all tallies across each day of stay ───────────────────────────
  // Tourist counts (country, residency, sex) are spread across every day the
  // guest is present — not just the check-in day.  The check-out day counts
  // too (check-in Aug 6, check-out Aug 8 is 3 days / 2 nights).  Same-day
  // check-in/check-out counts on the single day (1 day / 0 nights).
  records.forEach(r => {
    const checkIn = _parseLocalDate(r.check_in);
    if (!checkIn) return;
    if (!r.check_out) return;

    const effectiveCheckOut = r.actual_check_out || r.check_out;
    const checkOut   = _parseLocalDate(effectiveCheckOut);
    const nights     = Math.max(0, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
    const guestCount = r.total_guests || 0;

    const country     = (r.lead_country || '').toUpperCase();
    const nationality = (r.lead_nationality || '');
    const sex         = (r.lead_sex || '').toLowerCase();
    const rawBucket   = _classifyResidenceBucket({ country, nationality, isOverseas: !!r.lead_is_overseas });
    const count       = _asInt(r.total_guests);

    let bucket = rawBucket;
    if (rawBucket === 'foreign_resident') {
      bucket = listedSet.has(country) ? 'listed_foreign_resident' : 'unlisted_foreign_resident';
    }

    const spreadDays = nights + 1;
    const arrivalDay = checkIn.getDate();

    for (let n = 0; n < spreadDays; n++) {
      const stayDate = new Date(checkIn);
      stayDate.setDate(checkIn.getDate() + n);
      if (stayDate.getFullYear() !== year || (stayDate.getMonth() + 1) !== month) continue;

      const stayDay = stayDate.getDate();

      // Rooms active on this specific day — each room counted only within its
      // own active window, not for the whole stay.
      const stayDateStr =
        `${stayDate.getFullYear()}-${String(stayDate.getMonth() + 1).padStart(2, '0')}-${String(stayDate.getDate()).padStart(2, '0')}`;
      const windows = roomWindows[r.id] || [];
      const rooms = windows.filter(w =>
        (!w.startDate || stayDateStr >= w.startDate) &&
        (!w.endDate || stayDateStr < w.endDate)
      ).length;

      // Rooms occupied per day
      roomsOccupiedByDay[stayDay] = (roomsOccupiedByDay[stayDay] || 0) + rooms;

      // Guest nights per day — only the actual overnight days.  A check-in
      // Aug 6 / check-out Aug 8 stay spreads tourist counts over 3 days but
      // contributes only 2 guest nights; same-day stays contribute 0.
      if (nights > 0 && n < nights) {
        guestNightsByDay[stayDay] = (guestNightsByDay[stayDay] || 0) + guestCount;

        // Guest nights attributed to the arrival day (for ALOS calculation)
        if (stayDay === arrivalDay) {
          guestNightsPerArrivalDay[stayDay] = (guestNightsPerArrivalDay[stayDay] || 0) + (nights * guestCount);
        }
      }

      // Country breakdown (all guests in party)
      if (rawBucket === 'foreign_resident' && country) {
        if (!countryByDay[country]) countryByDay[country] = { 0: 0 };
        countryByDay[country][stayDay] = (countryByDay[country][stayDay] || 0) + count;
        countryByDay[country][0]       = (countryByDay[country][0]       || 0) + count;
      }

      // Residency bucket totals (all guests in party)
      residentsByDay[stayDay] = residentsByDay[stayDay] || {};
      residentsByDay[stayDay][bucket] = (residentsByDay[stayDay][bucket] || 0) + count;
      residentsByDay[0][bucket]       = (residentsByDay[0][bucket]       || 0) + count;

      // Sex × residency breakdown — counts all guests in the party via the
      // record's male_count / female_count, not just the lead guest's sex.
      // Residence is a party-level attribute, so the bucket is resolved once.
      let maleCount   = _asInt(r.male_count);
      let femaleCount = _asInt(r.female_count);
      if (maleCount + femaleCount === 0) {
        // Defensive fallback for legacy/anomalous rows: count the lead guest only.
        if (sex === 'female') femaleCount = 1; else maleCount = 1;
      }
      sexByDay[stayDay] = sexByDay[stayDay] || { male: {}, female: {} };
      if (!sexByDay[stayDay].male)   sexByDay[stayDay].male   = {};
      if (!sexByDay[stayDay].female) sexByDay[stayDay].female = {};
      if (!sexByDay[0].male)         sexByDay[0].male         = {};
      if (!sexByDay[0].female)       sexByDay[0].female       = {};
      sexByDay[stayDay].male[bucket]   = (sexByDay[stayDay].male[bucket]   || 0) + maleCount;
      sexByDay[stayDay].female[bucket] = (sexByDay[stayDay].female[bucket] || 0) + femaleCount;
      sexByDay[0].male[bucket]         = (sexByDay[0].male[bucket]         || 0) + maleCount;
      sexByDay[0].female[bucket]       = (sexByDay[0].female[bucket]       || 0) + femaleCount;
    }
  });

  totalGuestNights = Object.values(guestNightsByDay).reduce((a, b) => a + b, 0);

  return {
    month,
    year,
    countryByDay,
    residentsByDay,
    sexByDay,
    roomsOccupied: roomsOccupiedByDay,
    guestNightsByDay,
    guestNightsPerArrivalDay,
    guestNights: totalGuestNights,
  };
}

// ─── VAR Month Data (per-establishment aggregated by sex × residence) ────────

async function _fetchVarMonthData(businessId, businessCity, businessProvince, month, year) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay  = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const [records] = await db.pool.execute(
    `SELECT id, check_in, check_out, actual_check_out, total_guests,
            lead_country, lead_sex, lead_nationality, lead_is_overseas,
            lead_city_municipality, lead_province,
            male_count, female_count
     FROM guest_records
     WHERE business_id = ? AND is_deleted = false
       AND COALESCE(actual_check_out, check_out) >= ? AND check_in <= ?
       AND status IN ('active', 'archived')`,
    [businessId, firstDay, lastDay]
  );

  const data = {
    maleThisCity: 0, femaleThisCity: 0,
    maleOtherCity: 0, femaleOtherCity: 0,
    maleOtherProvince: 0, femaleOtherProvince: 0,
    maleForeign: 0, femaleForeign: 0,
  };

  const bCity = _normalizeCityName(businessCity);
  const bProv = (businessProvince || '').toUpperCase();

  records.forEach(r => {
    const checkIn = _parseLocalDate(r.check_in);
    if (!checkIn || !r.check_out) return;

    const effectiveCheckOut = r.actual_check_out || r.check_out;
    const checkOut = _parseLocalDate(effectiveCheckOut);
    const nights   = Math.max(0, Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)));
    // VAR spread (tourist presence day count): the check-out day counts too
    // (check-in Aug 6, check-out Aug 8 is 3 days; same-day stays are 1 day).
    const spreadDays = nights + 1;

    // Sex distribution uses the record's male_count / female_count (all guests
    // in the party), not just the lead guest's sex.  Residence is a party-level
    // attribute, so the bucket is resolved once from the lead guest's address.
    let maleCount   = _asInt(r.male_count);
    let femaleCount = _asInt(r.female_count);
    if (maleCount + femaleCount === 0) {
      // Defensive fallback for legacy/anomalous rows: count the lead guest only.
      const sex = (r.lead_sex || '').toLowerCase();
      if (sex === 'female') femaleCount = 1; else maleCount = 1;
    }

    const gCountry = (r.lead_country || '').toUpperCase();
    const isForeign = !!r.lead_is_overseas || (gCountry !== '' && gCountry !== 'PHILIPPINES');

    let maleBucket;
    let femaleBucket;
    if (isForeign) {
      maleBucket   = 'maleForeign';
      femaleBucket = 'femaleForeign';
    } else {
      const gCity = _normalizeCityName(r.lead_city_municipality);
      const gProv = (r.lead_province || '').toUpperCase();
      if (gCity && gCity === bCity) {
        maleBucket   = 'maleThisCity';
        femaleBucket = 'femaleThisCity';
      } else if (gProv && gProv === bProv) {
        maleBucket   = 'maleOtherCity';
        femaleBucket = 'femaleOtherCity';
      } else {
        maleBucket   = 'maleOtherProvince';
        femaleBucket = 'femaleOtherProvince';
      }
    }

    for (let n = 0; n < spreadDays; n++) {
      const stayDate = new Date(checkIn);
      stayDate.setDate(checkIn.getDate() + n);
      if (stayDate.getFullYear() !== year || (stayDate.getMonth() + 1) !== month) continue;
      data[maleBucket]   += maleCount;
      data[femaleBucket] += femaleCount;
    }
  });

  return data;
}

// ─── VAR 1 (Tourist Attraction) month aggregation ────────────────────────────
// Daily sex × residence grid from attraction_visit_logs for a single month.
// The VAR 1 form classifies Philippine visitors against the attraction's
// location; attractions are San Pablo City-only, so This City/Municipality is
// SAN PABLO CITY and same-province residents are Other City/Municipality.
async function _fetchAttractionMonthData(attractionId, month, year) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay  = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`;

  const [records] = await db.pool.execute(
    `SELECT visit_date, guest_count, male_count, female_count,
            country, province, city_municipality
     FROM attraction_visit_logs
     WHERE attraction_id = ? AND visit_date BETWEEN ? AND ? AND deleted_at IS NULL`,
    [attractionId, firstDay, lastDay]
  );

  const kCity = _normalizeCityName('San Pablo City');
  const kProv = 'LAGUNA';

  const emptyBucket = () => ({
    maleThisCity: 0, femaleThisCity: 0,
    maleOtherCity: 0, femaleOtherCity: 0,
    maleOtherProvince: 0, femaleOtherProvince: 0,
    maleForeign: 0, femaleForeign: 0,
  });

  const daily = {};
  const totals = emptyBucket();

  records.forEach(r => {
    const visitDate = _parseLocalDate(r.visit_date);
    if (!visitDate) return;
    const dayKey = String(visitDate.getDate());

    let maleCount   = _asInt(r.male_count);
    let femaleCount = _asInt(r.female_count);
    if (maleCount + femaleCount === 0) {
      // Defensive fallback: split guest_count using the PSA national ratio.
      const guest = _asInt(r.guest_count);
      maleCount = Math.round(guest * 0.471);
      femaleCount = guest - maleCount;
    }

    const gCountry = (r.country || '').toUpperCase();
    const isForeign = gCountry !== '' && gCountry !== 'PHILIPPINES';

    let maleBucket;
    let femaleBucket;
    if (isForeign) {
      maleBucket   = 'maleForeign';
      femaleBucket = 'femaleForeign';
    } else {
      const gCity = _normalizeCityName(r.city_municipality);
      const gProv = (r.province || '').toUpperCase();
      if (gCity && gCity === kCity) {
        maleBucket   = 'maleThisCity';
        femaleBucket = 'femaleThisCity';
      } else if (gProv && gProv === kProv) {
        maleBucket   = 'maleOtherCity';
        femaleBucket = 'femaleOtherCity';
      } else {
        maleBucket   = 'maleOtherProvince';
        femaleBucket = 'femaleOtherProvince';
      }
    }

    const entry = (daily[dayKey] ??= emptyBucket());
    entry[maleBucket]   += maleCount;
    entry[femaleBucket] += femaleCount;
    totals[maleBucket]   += maleCount;
    totals[femaleBucket] += femaleCount;
  });

  return { month, year, daily, totals };
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

// ─── Default-font patch ───────────────────────────────────────────────────────
// ExcelJS always writes Calibri as the workbook default (zero) font, which
// changes how stored column widths ("characters of the default font") render.
// This swaps font[0] in the generated styles.xml back to the template's default
// font so exports display at the same widths as the templates.

async function _patchDefaultFont(buffer, fontXml) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const styles = await zip.file('xl/styles.xml').async('string');
    const patched = styles.replace(/(<fonts[^>]*>)(<font>[\s\S]*?<\/font>)/, `$1${fontXml}`);
    if (patched === styles) {
      console.warn('[report] Default font patch: no <fonts> block found, export unchanged');
      return buffer;
    }
    zip.file('xl/styles.xml', patched);
    return await zip.generateAsync({ type: 'nodebuffer' });
  } catch (err) {
    console.warn('[report] Default font patch skipped:', err.message);
    return buffer;
  }
}

// ExcelJS writes every image anchor with colOff/rowOff zeroed and editAs
// "oneCell".  Restore the template's exact EMU offsets (and the default
// two-cell edit behavior) so the VAR 1 logo + QR sit precisely where the
// blank template places them.
async function _patchVar1ImageOffsets(buffer) {
  const _matchSpec = (inner) => {
    const m = inner.match(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>\d+<\/xdr:rowOff><\/xdr:from><xdr:to><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/);
    if (!m) return null;
    return kVar1ImageAnchors.find(s =>
      s.fromCol === +m[1] && s.fromRow === +m[2] &&
      s.toCol === +m[3] && s.toRow === +m[4]) || null;
  };

  const _applyOffsets = (inner, spec) => {
    let out = inner;
    out = out.replace(/<xdr:from>([\s\S]*?)<\/xdr:from>/, (block, f) =>
      `<xdr:from>${f
        .replace(/<xdr:colOff>\d+<\/xdr:colOff>/, `<xdr:colOff>${spec.fromColOff}</xdr:colOff>`)
        .replace(/<xdr:rowOff>\d+<\/xdr:rowOff>/, `<xdr:rowOff>${spec.fromRowOff}</xdr:rowOff>`)}</xdr:from>`);
    out = out.replace(/<xdr:to>([\s\S]*?)<\/xdr:to>/, (block, t) =>
      `<xdr:to>${t
        .replace(/<xdr:colOff>\d+<\/xdr:colOff>/, `<xdr:colOff>${spec.toColOff}</xdr:colOff>`)
        .replace(/<xdr:rowOff>\d+<\/xdr:rowOff>/, `<xdr:rowOff>${spec.toRowOff}</xdr:rowOff>`)}</xdr:to>`);
    return out;
  };

  try {
    const zip = await JSZip.loadAsync(buffer);
    const drawings = Object.keys(zip.files)
      .filter(name => /^xl\/drawings\/drawing\d+\.xml$/.test(name));

    let anyChanged = false;
    for (const name of drawings) {
      let xml = await zip.file(name).async('string');
      let changed = false;
      xml = xml.replace(/<xdr:twoCellAnchor([^>]*)>([\s\S]*?)<\/xdr:twoCellAnchor>/g, (block, attrs, inner) => {
        const spec = _matchSpec(inner);
        if (!spec) return block;
        changed = true;
        return `<xdr:twoCellAnchor>${_applyOffsets(inner, spec)}</xdr:twoCellAnchor>`;
      });
      if (changed) {
        zip.file(name, xml);
        anyChanged = true;
      }
    }

    if (!anyChanged) {
      console.warn('[report] VAR 1 image offset patch: no matching anchors found, export unchanged');
      return buffer;
    }
    return await zip.generateAsync({ type: 'nodebuffer' });
  } catch (err) {
    console.warn('[report] VAR 1 image offset patch skipped:', err.message);
    return buffer;
  }
}

// ─── Template Cloning ────────────────────────────────────────────────────────
// Copies an entire template worksheet (styles, merges, column widths, row
// heights, static text) into the target workbook so that data writers can
// overlay values on top of a pre-formatted DAE-1B form.

function _cloneSheetFromTemplate(templateSheet, newName, targetWb) {
  const newSheet = targetWb.addWorksheet(newName);

  // ── Column widths & properties ───────────────────────────────────────────
  templateSheet.columns.forEach((col, i) => {
    const nc = newSheet.getColumn(i + 1);
    if (col.width) nc.width = col.width;
    if (col.style !== undefined) nc.style = col.style;
    if (col.outlineLevel) nc.outlineLevel = col.outlineLevel;
    if (col.hidden) nc.hidden = col.hidden;
    if (col.collapsed) nc.collapsed = col.collapsed;
  });

  // ── Row-by-row clone (values + styles) ───────────────────────────────────
  templateSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = newSheet.getRow(rowNumber);
    if (row.height) newRow.height = row.height;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);

      // Copy value (resolve formulas to cached result to avoid cross-sheet refs)
      if (cell.type === ExcelJS.ValueType.Formula) {
        newCell.value = cell.result ?? 0;
      } else if (cell.type === ExcelJS.ValueType.Merge) {
        // Skip merge-marker cells; the merge range is restored below
        newCell.value = null;
      } else {
        newCell.value = cell.value;
      }

      // Deep-copy style (font, fill, border, alignment, numberFormat …)
      if (cell.style && Object.keys(cell.style).length > 0) {
        newCell.style = JSON.parse(JSON.stringify(cell.style));
      }
    });
  });

  // ── Merged cell ranges ───────────────────────────────────────────────────
  if (templateSheet._merges) {
    for (const merge of Object.values(templateSheet._merges)) {
      try {
        newSheet.mergeCellsWithoutStyle(
          merge.model.top, merge.model.left,
          merge.model.bottom, merge.model.right,
        );
      } catch (_) { /* ignore overlapping merges from template */ }
    }
  }

  // ── Sheet-level properties ──────────────────────────────────────────────
  if (templateSheet.properties) {
    if (templateSheet.properties.defaultRowHeight !== undefined) {
      newSheet.properties.defaultRowHeight = templateSheet.properties.defaultRowHeight;
    }
    if (templateSheet.properties.defaultColumnWidth !== undefined) {
      newSheet.properties.defaultColumnWidth = templateSheet.properties.defaultColumnWidth;
    }
  }

  // ── Page setup ───────────────────────────────────────────────────────────
  if (templateSheet.pageSetup) {
    newSheet.pageSetup = JSON.parse(JSON.stringify(templateSheet.pageSetup));
  }
  if (templateSheet.views && templateSheet.views.length) {
    newSheet.views = JSON.parse(JSON.stringify(templateSheet.views));
  }

  return newSheet;
}

// ─── Excel Builders ──────────────────────────────────────────────────────────

// ==============================================================================================
// ======================================== DAILY SHEET =========================================
// ==============================================================================================

function _buildDailySheet(sheet, biz, md, month, year, daysInMonth, adminName) {
  const r = kRows.daily;

  sheet.getCell('B3').value = 'Region: __4-A';
  sheet.getCell('A4').value = `${kMonthNames[month].substring(0, 3).charAt(0)}${kMonthNames[month].substring(1, 3).toLowerCase()}-${String(year).slice(-2)}`;
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
  sheet.getCell('A19').value = `AE ID Code (LGU Assigned): ${biz.ae_id || ''}`;
  sheet.getCell('A20').value = `AE ID Code (LGU Assigned): ${biz.ae_id || ''}`;

  // Subtotal/total rows show 0 by default (matching template formulas); data rows stay blank.
  const _subtotalTotalRows = new Set([30, 45, 53, 62, 73, 80, 88, 99, 108, 116, 122, 131, 136, 139, 141, 143, 145, 146, 147, 148]);
  const setDayValues = (rowNum, fn) => {
    const useZero = _subtotalTotalRows.has(rowNum);
    const subForm = kDailySubtotalFormulas[rowNum];
    const specForm = kDailySpecialFormulas[rowNum];
    for (let d = 1; d <= 31; d++) {
      if (d > daysInMonth) { sheet.getCell(rowNum, d + 1).value = null; continue; }
      if (subForm) {
        const col = _colLetter(d + 1);
        sheet.getCell(rowNum, d + 1).value = { formula: `SUM(${col}${subForm.start}:${col}${subForm.end})` };
      } else if (specForm) {
        const col = _colLetter(d + 1);
        sheet.getCell(rowNum, d + 1).value = { formula: specForm.map(ref => `${col}${ref}`).join('+') };
      } else {
        const v = fn(d);
        sheet.getCell(rowNum, d + 1).value = useZero ? (v ?? 0) : (v || null);
      }
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

  // Rooms available per day = total rooms − rooms occupied that day
  setDayValues(r.roomsOccupied, d => md.roomsOccupied[d] || null);
  setDayValues(r.roomsAvailable, d => {
    const totalRooms = biz.total_rooms || 0;
    const occupied    = md.roomsOccupied[d] || 0;
    return totalRooms > 0 ? totalRooms - occupied : null;
  });
  setDayValues(r.guestNights, d => md.guestNightsByDay[d] || null);

  setDayValues(r.occupancyRate, _ => null);
  setDayValues(r.alos, _ => null);

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
  const writeTotal = (rowNum) => {
    sheet.getCell(rowNum, kTotalCol).value = { formula: `SUM(B${rowNum}:AF${rowNum})` };
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
  const totalRoomsAll    = biz.total_rooms || 0;
  const totalRoomsAvail  = totalRoomsAll * daysInMonth;
  writeTotal(r.roomsOccupied, totalRoomsOccAll);
  writeTotal(r.roomsAvailable, totalRoomsAvail > 0 ? totalRoomsAvail - totalRoomsOccAll : null);
  writeTotal(r.guestNights, md.guestNights);
  writeTotal(r.occupancyRate);
  writeTotal(r.alos);

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
  sheet.getCell('A4').value = `${kMonthNames[month].substring(0, 3).charAt(0)}${kMonthNames[month].substring(1, 3).toLowerCase()}-${String(year).slice(-2)}`;
  sheet.getCell('A5').value = `${kMonthNames[month]}, ${year}`;

  sheet.getCell('A22').value = `City/Municipality: ${city || ''}`;
  sheet.getCell('A23').value = `Province: ${province || ''}`;
  sheet.getCell('A19').value = `AE ID Code (LGU Assigned): ${biz?.ae_id || ''}`;
  sheet.getCell('A20').value = `AE ID Code (LGU Assigned): ${biz?.ae_id || ''}`;

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
  sheet.getCell(`B${r.phResTotal}`).value = (res('philippine_resident_filipino') + res('philippine_resident_foreign')) ?? 0;

  kCountryRows.forEach(c => { sheet.getCell(`B${c.sum}`).value = cnt(c.country); });

  kRegionalGroups.forEach(g => {
    const subtotal = g.countries.reduce((sum, country) => sum + cnt(country), 0);
    sheet.getCell(`B${g.sumRow}`).value = subtotal ?? 0;
  });

  const othersAndUnspecifiedTotal = res('unlisted_foreign_resident') + res('unspecified_guest');
  sheet.getCell(`B${r.otherCountries}`).value = othersAndUnspecifiedTotal ?? 0;
  sheet.getCell(`B${r.totalForeign}`).value = (res('listed_foreign_resident') + res('unlisted_foreign_resident') + res('unspecified_guest')) ?? 0;
  sheet.getCell(`B${r.unspecified}`).value = othersAndUnspecifiedTotal ?? 0;
  sheet.getCell(`B${r.overseasFilipino}`).value = res('overseas_filipino') ?? 0;

  const grandTotal =
    res('philippine_resident_filipino') +
    res('philippine_resident_foreign') +
    res('listed_foreign_resident') +
    res('unlisted_foreign_resident') +
    res('unspecified_guest') +
    res('overseas_filipino');
  sheet.getCell(`B${r.grandTotal}`).value = grandTotal ?? 0;

  sheet.getCell(`B${r.summaryPhTotal}`).value = (res('philippine_resident_filipino') + res('philippine_resident_foreign')) ?? 0;
  sheet.getCell(`B${r.summaryForeignTotal}`).value = (res('listed_foreign_resident') + res('unlisted_foreign_resident') + res('unspecified_guest')) ?? 0;
  sheet.getCell(`B${r.summaryOverseasTotal}`).value = res('overseas_filipino') ?? 0;

  const totalRoomsOcc  = Object.values(md.roomsOccupied).reduce((a, b) => a + b, 0);
  const totalRoomsAvail = totalRoomsAll * daysInMonth;
  sheet.getCell(`B${r.roomsOccupied}`).value = totalRoomsOcc ?? 0;
  sheet.getCell(`B${r.roomsAvailable}`).value = totalRoomsAvail > 0 ? totalRoomsAvail - totalRoomsOcc : 0;
  sheet.getCell(`B${r.guestNights}`).value = md.guestNights ?? 0;

  sheet.getCell(`B${r.occupancyRate}`).value = 0;
  sheet.getCell(`B${r.alos}`).value = 0;

  const setSexValues = (rowStart, gender) => {
    sheet.getCell(`B${rowStart + 1}`).value = (sex(gender, 'philippine_resident_filipino') + sex(gender, 'philippine_resident_foreign')) ?? 0;
    sheet.getCell(`B${rowStart + 2}`).value = (sex(gender, 'listed_foreign_resident') + sex(gender, 'unlisted_foreign_resident') + sex(gender, 'unspecified_guest')) ?? 0;
    sheet.getCell(`B${rowStart + 3}`).value = sex(gender, 'overseas_filipino') ?? 0;
    sheet.getCell(`B${rowStart + 4}`).value = (sex(gender, 'unlisted_foreign_resident') + sex(gender, 'unspecified_guest')) ?? 0;
    sheet.getCell(`B${rowStart + 5}`).value = 
      (sex(gender, 'philippine_resident_filipino') +
       sex(gender, 'philippine_resident_foreign') +
       sex(gender, 'listed_foreign_resident') +
       sex(gender, 'unlisted_foreign_resident') +
       sex(gender, 'overseas_filipino') +
       sex(gender, 'unspecified_guest')) ?? 0;
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
  sheet.getCell('A4').value = `Jan-Dec, ${year}`;
  sheet.getCell('A22').value = `City/Municipality: ${city || ''}`;
  sheet.getCell('A23').value = `Province: ${province || ''}`;
  sheet.getCell('A19').value = `AE ID Code (LGU Assigned): ${biz?.ae_id || ''}`;
  sheet.getCell('A20').value = `AE ID Code (LGU Assigned): ${biz?.ae_id || ''}`;

  const bizLines = typeof biz?.business_line === 'string'
    ? JSON.parse(biz.business_line || '[]')
    : (biz?.business_line || []);
  kAccTypes.forEach(t => {
    if (bizLines.includes(t.key)) {
      sheet.getCell(`B${t.row}`).value     = '\u2714';
      sheet.getCell(`B${t.row}`).alignment = { horizontal: 'center' };
    }
  });

  const _sumTotalRows = new Set([30, 45, 53, 62, 72, 80, 88, 99, 108, 116, 122, 130, 137, 140, 142, 144, 146, 147, 148, 149, 150, 159, 160]);
  const setMonthValues = (rowNum, fn) => {
    const useZero = _sumTotalRows.has(rowNum);
    const subForm = kMonthlySubtotalFormulas[rowNum];
    const specForm = kMonthlySpecialFormulas[rowNum];
    const rangeForm = kMonthlyRangeFormulas[rowNum];
    for (let i = 0; i < allMonths.length; i++) {
      const col = _colLetter(i + 2);
      if (subForm) {
        sheet.getCell(rowNum, i + 2).value = { formula: `SUM(${col}${subForm.start}:${col}${subForm.end})` };
      } else if (rangeForm) {
        sheet.getCell(rowNum, i + 2).value = { formula: `SUM(${col}${rangeForm.start}:${col}${rangeForm.end})` };
      } else if (specForm) {
        sheet.getCell(rowNum, i + 2).value = { formula: specForm.map(ref => `${col}${ref}`).join('+') };
      } else {
        const val = fn(allMonths[i].month);
        sheet.getCell(rowNum, i + 2).value = useZero ? (val ?? 0) : (val || null);
      }
    }
    // Year total column — inject formula instead of pre-computed value
    const totalCol = allMonths.length + 2;
    const firstCol = _colLetter(2);
    const lastCol = _colLetter(allMonths.length + 1);
    if (rowNum === 159 || rowNum === 160) {
      sheet.getCell(rowNum, totalCol).value = { formula: `AVERAGE(${firstCol}${rowNum}:${lastCol}${rowNum})` };
    } else {
      sheet.getCell(rowNum, totalCol).value = { formula: `SUM(${firstCol}${rowNum}:${lastCol}${rowNum})` };
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
  setMonthValues(r.roomsAvailable, m => {
    const daysInM   = new Date(year, m, 0).getDate();
    const totalOcc  = Object.values(mdFor(m).roomsOccupied).reduce((a, b) => a + b, 0);
    const totalAvail = totalRoomsAll * daysInM;
    return totalAvail > 0 ? totalAvail - totalOcc : null;
  });
  setMonthValues(r.guestNights, m => mdFor(m).guestNights);

  for (let i = 0; i < allMonths.length; i++) {
    sheet.getCell(r.occupancyRate, i + 2).value = null;
    sheet.getCell(r.alos, i + 2).value = null;
  }

  const lastCol = allMonths.length + 2;
  const _firstCol = _colLetter(2);
  const _lastMonthCol = _colLetter(allMonths.length + 1);
  sheet.getCell(r.occupancyRate, lastCol).value = 0;
  sheet.getCell(r.alos, lastCol).value = 0;

  const setMonthlySexValues = (rowStart, gender) => {
    setMonthValues(rowStart + 1, m => (mSex(m, gender, 'philippine_resident_filipino') + mSex(m, gender, 'philippine_resident_foreign')) || null);
    setMonthValues(rowStart + 2, m => (mSex(m, gender, 'listed_foreign_resident') + mSex(m, gender, 'unlisted_foreign_resident') + mSex(m, gender, 'unspecified_guest')) || null);
    setMonthValues(rowStart + 3, m => mSex(m, gender, 'overseas_filipino') || null);
    setMonthValues(rowStart + 4, m => (mSex(m, gender, 'unlisted_foreign_resident') + mSex(m, gender, 'unspecified_guest')) || null);
    setMonthValues(rowStart + 5, m => {
      return (mSex(m, gender, 'philippine_resident_filipino') +
             mSex(m, gender, 'philippine_resident_foreign') +
             mSex(m, gender, 'listed_foreign_resident') +
             mSex(m, gender, 'unlisted_foreign_resident') +
             mSex(m, gender, 'overseas_filipino') +
             mSex(m, gender, 'unspecified_guest')) || null;
    });
  };
  setMonthlySexValues(r.maleStart, 'male');
  setMonthlySexValues(r.femaleStart, 'female');

  // ── Remove unused month columns for the requested range ──────────────────
  // Template has 12 month columns (B-M) + 1 total column (N).
  // After writing, data occupies columns 2..(allMonths.length+1) and total at
  // allMonths.length+2.  Delete leftover template columns after the total.
  const unusedMonthCols = 12 - allMonths.length;
  if (unusedMonthCols > 0) {
    sheet.spliceColumns(allMonths.length + 3, unusedMonthCols);
  }
}

// ==============================================================================================
// ======================================== VAR EXCEL SHEET ======================================
// ==============================================================================================

// Column positions in VAR-REPORT.xlsx (1-indexed, A=1)
const kVarCols = {
  name: 2,            // B
  attrCode: 3,        // C
  maleThisCity: 4,    // D
  femaleThisCity: 5,  // E
  totalThisCity: 6,   // F
  maleOtherCity: 7,   // G
  femaleOtherCity: 8, // H
  totalOtherCity: 9,  // I
  maleOtherProv: 10,  // J
  femaleOtherProv: 11,// K
  totalOtherProv: 12, // L
  maleForeign: 13,    // M
  femaleForeign: 14,  // N
  totalForeign: 15,   // O
  grandMale: 16,      // P
  grandFemale: 17,    // Q
  grandTotal: 18,     // R
};

const kVarDataRowStart = 16;
const kVarTotalRow = 57;

function _buildVarExcelSheet(sheet, businesses, varDataList, sortedMonths, year) {
  const kVarMonthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const kVarMonthAbbr = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const monthLabel = sortedMonths.length === 1
    ? `${kVarMonthNames[sortedMonths[0]]}, ${year}`
    : `${kVarMonthAbbr[sortedMonths[0]]}-${kVarMonthAbbr[sortedMonths[sortedMonths.length - 1]]}, ${year}`;

  // Update header fields
  // Row 9: Month/Year — write value in the cells near E9
  sheet.getCell('G9').value = monthLabel;

  // Row 10: Municipality — write the first business city or leave template default
  if (businesses.length === 1) {
    sheet.getCell('G10').value = (businesses[0].city_municipality || '').toUpperCase();
  }

  const c = kVarCols;

  // ── Inject default per-row formulas (evaluated later for PDF) ─────────────
  // Formulas get no cached result — _evaluateFormulasInSheet computes them
  // before PDF rendering.  Business rows below overwrite with the actual data.
  for (let row = kVarDataRowStart; row < kVarTotalRow; row++) {
    sheet.getRow(row).getCell(c.totalThisCity).value  = { formula: `D${row}+E${row}` };
    sheet.getRow(row).getCell(c.totalOtherCity).value  = { formula: `G${row}+H${row}` };
    sheet.getRow(row).getCell(c.totalOtherProv).value  = { formula: `J${row}+K${row}` };
    sheet.getRow(row).getCell(c.totalForeign).value    = { formula: `M${row}+N${row}` };
    sheet.getRow(row).getCell(c.grandMale).value       = { formula: `D${row}+G${row}+J${row}+M${row}` };
    sheet.getRow(row).getCell(c.grandFemale).value     = { formula: `E${row}+H${row}+K${row}+N${row}` };
    sheet.getRow(row).getCell(c.grandTotal).value      = { formula: `F${row}+I${row}+L${row}+O${row}` };
  }

  // ── Write data rows (one per establishment) ──────────────────────────────
  // Input columns D,E,G,H,J,K,M,N get raw numbers.  Computed columns
  // F,I,L,O,P,Q,R get formula + cached JS result (for PDF rendering).
  businesses.forEach((biz, i) => {
    const rowNum = kVarDataRowStart + i;
    if (rowNum > kVarTotalRow - 1) return;

    const vd = varDataList[i] || {};

    const maleThisCity    = vd.maleThisCity || 0;
    const femaleThisCity  = vd.femaleThisCity || 0;
    const maleOtherCity   = vd.maleOtherCity || 0;
    const femaleOtherCity = vd.femaleOtherCity || 0;
    const maleOtherProv   = vd.maleOtherProvince || 0;
    const femaleOtherProv = vd.femaleOtherProvince || 0;
    const maleForeign     = vd.maleForeign || 0;
    const femaleForeign   = vd.femaleForeign || 0;

    const totalThisCity   = maleThisCity + femaleThisCity;
    const totalOtherCity  = maleOtherCity + femaleOtherCity;
    const totalOtherProv  = maleOtherProv + femaleOtherProv;
    const totalForeign    = maleForeign + femaleForeign;
    const grandMale       = maleThisCity + maleOtherCity + maleOtherProv + maleForeign;
    const grandFemale     = femaleThisCity + femaleOtherCity + femaleOtherProv + femaleForeign;
    const grandTotal      = totalThisCity + totalOtherCity + totalOtherProv + totalForeign;

    sheet.getRow(rowNum).getCell(c.name).value           = biz.business_name;
    sheet.getRow(rowNum).getCell(c.attrCode).value       = biz.attrCode || '9-902';
    sheet.getRow(rowNum).getCell(c.maleThisCity).value    = maleThisCity || null;
    sheet.getRow(rowNum).getCell(c.femaleThisCity).value   = femaleThisCity || null;
    sheet.getRow(rowNum).getCell(c.maleOtherCity).value    = maleOtherCity || null;
    sheet.getRow(rowNum).getCell(c.femaleOtherCity).value   = femaleOtherCity || null;
    sheet.getRow(rowNum).getCell(c.maleOtherProv).value    = maleOtherProv || null;
    sheet.getRow(rowNum).getCell(c.femaleOtherProv).value   = femaleOtherProv || null;
    sheet.getRow(rowNum).getCell(c.maleForeign).value      = maleForeign || null;
    sheet.getRow(rowNum).getCell(c.femaleForeign).value     = femaleForeign || null;
    // Override default with formula (evaluated by _evaluateFormulasInSheet for PDF)
    sheet.getRow(rowNum).getCell(c.totalThisCity).value   = { formula: `D${rowNum}+E${rowNum}` };
    sheet.getRow(rowNum).getCell(c.totalOtherCity).value  = { formula: `G${rowNum}+H${rowNum}` };
    sheet.getRow(rowNum).getCell(c.totalOtherProv).value  = { formula: `J${rowNum}+K${rowNum}` };
    sheet.getRow(rowNum).getCell(c.totalForeign).value    = { formula: `M${rowNum}+N${rowNum}` };
    sheet.getRow(rowNum).getCell(c.grandMale).value       = { formula: `D${rowNum}+G${rowNum}+J${rowNum}+M${rowNum}` };
    sheet.getRow(rowNum).getCell(c.grandFemale).value     = { formula: `E${rowNum}+H${rowNum}+K${rowNum}+N${rowNum}` };
    sheet.getRow(rowNum).getCell(c.grandTotal).value      = { formula: `F${rowNum}+I${rowNum}+L${rowNum}+O${rowNum}` };
  });

  // ── Write total row (row 57) with SUM formulas ────────────────────────────
  // Formulas are evaluated by _evaluateFormulasInSheet before PDF rendering.
  const totalRow = sheet.getRow(kVarTotalRow);
  const lastDataRow = kVarTotalRow - 1;

  const _sumCol = (col) => {
    let total = 0;
    for (let r = kVarDataRowStart; r <= lastDataRow; r++) {
      const cell = sheet.getCell(r, col);
      const v = cell.value;
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') total += v;
      else if (typeof v === 'object' && v.result !== undefined && v.result !== null) total += Number(v.result) || 0;
    }
    return total;
  };

  const dTotal = _sumCol(c.maleThisCity);
  const eTotal = _sumCol(c.femaleThisCity);
  const gTotal = _sumCol(c.maleOtherCity);
  const hTotal = _sumCol(c.femaleOtherCity);
  const jTotal = _sumCol(c.maleOtherProv);
  const kTotal = _sumCol(c.femaleOtherProv);
  const mTotal = _sumCol(c.maleForeign);
  const nTotal = _sumCol(c.femaleForeign);

  const fTotal = dTotal + eTotal;
  const iTotal = gTotal + hTotal;
  const lTotal = jTotal + kTotal;
  const oTotal = mTotal + nTotal;
  const pTotal = dTotal + gTotal + jTotal + mTotal;
  const qTotal = eTotal + hTotal + kTotal + nTotal;
  const rTotal = fTotal + iTotal + lTotal + oTotal;

  totalRow.getCell(c.maleThisCity).value   = { formula: `SUM(D${kVarDataRowStart}:D${lastDataRow})` };
  totalRow.getCell(c.femaleThisCity).value  = { formula: `SUM(E${kVarDataRowStart}:E${lastDataRow})` };
  totalRow.getCell(c.totalThisCity).value   = { formula: `SUM(F${kVarDataRowStart}:F${lastDataRow})` };
  totalRow.getCell(c.maleOtherCity).value   = { formula: `SUM(G${kVarDataRowStart}:G${lastDataRow})` };
  totalRow.getCell(c.femaleOtherCity).value  = { formula: `SUM(H${kVarDataRowStart}:H${lastDataRow})` };
  totalRow.getCell(c.totalOtherCity).value   = { formula: `SUM(I${kVarDataRowStart}:I${lastDataRow})` };
  totalRow.getCell(c.maleOtherProv).value   = { formula: `SUM(J${kVarDataRowStart}:J${lastDataRow})` };
  totalRow.getCell(c.femaleOtherProv).value  = { formula: `SUM(K${kVarDataRowStart}:K${lastDataRow})` };
  totalRow.getCell(c.totalOtherProv).value   = { formula: `SUM(L${kVarDataRowStart}:L${lastDataRow})` };
  totalRow.getCell(c.maleForeign).value     = { formula: `SUM(M${kVarDataRowStart}:M${lastDataRow})` };
  totalRow.getCell(c.femaleForeign).value    = { formula: `SUM(N${kVarDataRowStart}:N${lastDataRow})` };
  totalRow.getCell(c.totalForeign).value     = { formula: `SUM(O${kVarDataRowStart}:O${lastDataRow})` };
  totalRow.getCell(c.grandMale).value        = { formula: `SUM(P${kVarDataRowStart}:P${lastDataRow})` };
  totalRow.getCell(c.grandFemale).value      = { formula: `SUM(Q${kVarDataRowStart}:Q${lastDataRow})` };
  totalRow.getCell(c.grandTotal).value       = { formula: `F${kVarTotalRow}+I${kVarTotalRow}+L${kVarTotalRow}+O${kVarTotalRow}` };

}

// ─── VAR 1 (Tourist Attraction) sheet builder ────────────────────────────────
// Column positions in same day blank.xlsx (1-indexed, A=1).
const kVar1Cols = {
  day: 2,             // B
  maleThisCity: 4,    // D
  femaleThisCity: 5,  // E
  totalThisCity: 6,   // F
  maleOtherCity: 7,   // G
  femaleOtherCity: 8, // H
  totalOtherCity: 9,  // I
  maleOtherProv: 10,  // J
  femaleOtherProv: 11,// K
  totalOtherProv: 12, // L
  maleForeign: 13,    // M
  femaleForeign: 14,  // N
  totalForeign: 15,   // O
  grandMale: 16,      // P
  grandFemale: 17,    // Q
  grandTotal: 18,     // R
};

const kVar1DayRowStart = 24; // day 1 lives at row 24 (template rows 24-54 = days 1-31)
const kVar1TotalRow = 55;

// Attraction type values as stored in tourist_attractions.attraction_type →
// the display labels used on the VAR 1 form.  Unknown values fall back to a
// title-cased version of the stored key.
const kAttractionTypeLabels = {
  ecotourism: 'Ecotourism',
  natural_attractions: 'Natural Attractions',
  cultural: 'Cultural',
  religious: 'Religious',
  historical_heritage_sites: 'Historical Heritage Sites',
  agri_tourism: 'Agri-Tourism',
  farm_tourism_sites: 'Farm Tourism Sites',
};

function _attractionTypeLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '';
  if (kAttractionTypeLabels[key]) return kAttractionTypeLabels[key];
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function _buildVar1ExcelSheet(sheet, attractionName, attractionType, daily, totals, month, year) {
  const c = kVar1Cols;
  const daysInMonth = new Date(year, month, 0).getDate();
  const kWeekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ── Header variable fields (rows 1-15 come from the template clone) ───────
  sheet.getCell('G14').value = `${kMonthNames[month]} ${year}`;          // Month/Year value (label at E14)
  sheet.getCell('G16').value = attractionName;                            // Name of attraction/ Spot (label at E16)
  // Type of Tourism Attraction — display labels go in the merged fill-in box
  // E18:G18 (label at D18).
  sheet.getCell('E18').value = (attractionType || []).map(_attractionTypeLabel).filter(Boolean).join(', ');

  // ── Day rows 24-54 ────────────────────────────────────────────────────────
  // Raw input columns D,E,G,H,J,K,M,N — the only cells filled from data.
  const rawInputCols = [
    c.maleThisCity, c.femaleThisCity,
    c.maleOtherCity, c.femaleOtherCity,
    c.maleOtherProv, c.femaleOtherProv,
    c.maleForeign, c.femaleForeign,
  ];

  // Computed columns F,I,L,O,P,Q,R — the template's per-row formulas, restored
  // in EVERY day row so Excel totals the counts itself (the clone resolves the
  // template's formulas to plain cached 0s, so they must be re-injected).
  const injectDayFormulas = (rowNum) => {
    sheet.getRow(rowNum).getCell(c.totalThisCity).value   = { formula: `D${rowNum}+E${rowNum}` };
    sheet.getRow(rowNum).getCell(c.totalOtherCity).value  = { formula: `G${rowNum}+H${rowNum}` };
    sheet.getRow(rowNum).getCell(c.totalOtherProv).value  = { formula: `J${rowNum}+K${rowNum}` };
    sheet.getRow(rowNum).getCell(c.totalForeign).value    = { formula: `M${rowNum}+N${rowNum}` };
    sheet.getRow(rowNum).getCell(c.grandMale).value       = { formula: `D${rowNum}+G${rowNum}+J${rowNum}+M${rowNum}` };
    sheet.getRow(rowNum).getCell(c.grandFemale).value     = { formula: `E${rowNum}+H${rowNum}+K${rowNum}+N${rowNum}` };
    sheet.getRow(rowNum).getCell(c.grandTotal).value      = { formula: `F${rowNum}+I${rowNum}+L${rowNum}+O${rowNum}` };
  };

  for (let day = 1; day <= 31; day++) {
    const rowNum = kVar1DayRowStart + day - 1;
    const d = daily[String(day)];

    // Keep the computed-column formulas in every row, data or not.
    injectDayFormulas(rowNum);

    if (day > daysInMonth) {
      // Days past month-end: blank the weekday + raw inputs (formulas kept)
      sheet.getRow(rowNum).getCell(3).value = null;
      rawInputCols.forEach(col => { sheet.getRow(rowNum).getCell(col).value = null; });
      continue;
    }

    // Week Day (Mon-Sun) — the actual calendar weekday for this date
    sheet.getRow(rowNum).getCell(3).value = kWeekdayNames[new Date(year, month - 1, day).getDay()];

    if (!d) {
      // In-month day with no recorded visits: clear the raw inputs but keep
      // the day number (template), weekday label and computed-column formulas.
      rawInputCols.forEach(col => { sheet.getRow(rowNum).getCell(col).value = null; });
      continue;
    }

    const maleThisCity    = d.maleThisCity || 0;
    const femaleThisCity  = d.femaleThisCity || 0;
    const maleOtherCity   = d.maleOtherCity || 0;
    const femaleOtherCity = d.femaleOtherCity || 0;
    const maleOtherProv   = d.maleOtherProvince || 0;
    const femaleOtherProv = d.femaleOtherProvince || 0;
    const maleForeign     = d.maleForeign || 0;
    const femaleForeign   = d.femaleForeign || 0;

    // Raw input columns D,E,G,H,J,K,M,N
    sheet.getRow(rowNum).getCell(c.maleThisCity).value    = maleThisCity || null;
    sheet.getRow(rowNum).getCell(c.femaleThisCity).value  = femaleThisCity || null;
    sheet.getRow(rowNum).getCell(c.maleOtherCity).value   = maleOtherCity || null;
    sheet.getRow(rowNum).getCell(c.femaleOtherCity).value = femaleOtherCity || null;
    sheet.getRow(rowNum).getCell(c.maleOtherProv).value   = maleOtherProv || null;
    sheet.getRow(rowNum).getCell(c.femaleOtherProv).value = femaleOtherProv || null;
    sheet.getRow(rowNum).getCell(c.maleForeign).value     = maleForeign || null;
    sheet.getRow(rowNum).getCell(c.femaleForeign).value   = femaleForeign || null;
  }

  // ── Total row (row 55) — mirrors the template's D55:Q55 SUM formulas ──────
  const lastDataRow = kVar1DayRowStart + 30; // 54
  const totalRow = sheet.getRow(kVar1TotalRow);
  totalRow.getCell(c.maleThisCity).value     = { formula: `SUM(D${kVar1DayRowStart}:D${lastDataRow})` };
  totalRow.getCell(c.femaleThisCity).value   = { formula: `SUM(E${kVar1DayRowStart}:E${lastDataRow})` };
  totalRow.getCell(c.totalThisCity).value    = { formula: `SUM(F${kVar1DayRowStart}:F${lastDataRow})` };
  totalRow.getCell(c.maleOtherCity).value    = { formula: `SUM(G${kVar1DayRowStart}:G${lastDataRow})` };
  totalRow.getCell(c.femaleOtherCity).value  = { formula: `SUM(H${kVar1DayRowStart}:H${lastDataRow})` };
  totalRow.getCell(c.totalOtherCity).value   = { formula: `SUM(I${kVar1DayRowStart}:I${lastDataRow})` };
  totalRow.getCell(c.maleOtherProv).value    = { formula: `SUM(J${kVar1DayRowStart}:J${lastDataRow})` };
  totalRow.getCell(c.femaleOtherProv).value  = { formula: `SUM(K${kVar1DayRowStart}:K${lastDataRow})` };
  totalRow.getCell(c.totalOtherProv).value   = { formula: `SUM(L${kVar1DayRowStart}:L${lastDataRow})` };
  totalRow.getCell(c.maleForeign).value      = { formula: `SUM(M${kVar1DayRowStart}:M${lastDataRow})` };
  totalRow.getCell(c.femaleForeign).value    = { formula: `SUM(N${kVar1DayRowStart}:N${lastDataRow})` };
  totalRow.getCell(c.totalForeign).value     = { formula: `SUM(O${kVar1DayRowStart}:O${lastDataRow})` };
  totalRow.getCell(c.grandMale).value        = { formula: `SUM(P${kVar1DayRowStart}:P${lastDataRow})` };
  totalRow.getCell(c.grandFemale).value      = { formula: `SUM(Q${kVar1DayRowStart}:Q${lastDataRow})` };
  // Column R grand total — mirrors the template's R51 formula (=F51+I51+L51+O51)
  totalRow.getCell(c.grandTotal).value       = { formula: `F${kVar1TotalRow}+I${kVar1TotalRow}+L${kVar1TotalRow}+O${kVar1TotalRow}` };
}

// ─── PDF Layout & Page-Break Config ─────────────────────────────────────────
const SHEET_PDF_CONFIG = {
  daily:   { layout: 'landscape', size: 'A4', margin: 28.35, breakRows: [64, 124] },
  monthly: { layout: 'landscape', size: 'A4', margin: 28.35, breakRows: [64, 124] },
  sum:     { layout: 'portrait',  size: 'A4', margin: 28.35, breakRows: [66, 128] },
  var:     { layout: 'portrait', size: 'A4', margin: 28.35, breakRows: [] },
};

function _getSheetPdfConfig(sheetName, reportType) {
  if (reportType === 'var2' || reportType === 'var1') return SHEET_PDF_CONFIG.var;
  if (sheetName === 'AE DAE-1B by Country (Sum)') return SHEET_PDF_CONFIG.sum;
  if (sheetName.includes('Monthly'))              return SHEET_PDF_CONFIG.monthly;
  return SHEET_PDF_CONFIG.daily;
}

// ─── PDF Generation (returns Buffer instead of writing to file) ──────────────

async function _generatePdfBuffer(workbook, variant, month, year, reportType = 'dae', options = {}) {
  const sheets = [];
  workbook.eachSheet(sheet => sheets.push(sheet));

  const pdfConfig = { ...(reportType === 'var2' || reportType === 'var1' ? SHEET_PDF_CONFIG.var
    : variant === 'summary' ? SHEET_PDF_CONFIG.sum
    : variant === 'series' ? SHEET_PDF_CONFIG.monthly
    : SHEET_PDF_CONFIG.daily) };

  const { pageWidth, pageHeight } = options;
  if (pageWidth != null && pageHeight != null) {
    pdfConfig.size = [pageWidth, pageHeight];
    pdfConfig.layout = 'portrait';
  }

  // Font metrics that convert Excel's stored column widths ("characters of the
  // default font") into physical points.  CHAR_WIDTH_PT = max digit width of the
  // template's default font at 96dpi: Arial/Calibri 11 → 7px = 5.25pt; MS PGothic 11
  // (VAR, half-width digits) → 8px = 6.0pt.  CELL_PAD_PT = Excel's 5px padding
  // each column adds, so column edges match Excel's rendered width exactly.
  const CHAR_WIDTH_PT = reportType === 'var2' ? 6.0 : 5.25;
  const CELL_PAD_PT = 3.75;
  const PAGE_DIMS = { A3: { w: 841.89, h: 1190.55 }, A4: { w: 595.28, h: 841.89 } };
  const BORDER_WIDTH = {
    hairline: 0.25,
    dotted: 0.75, dashed: 0.75, dashDot: 0.75, dashDotDot: 0.75,
    thin: 0.75,
    mediumDashDotDot: 1.5, mediumDashDot: 1.5, mediumDash: 1.5,
    medium: 1.5, slantDashDot: 1.5,
    thick: 2.25, double: 2.25,
  };
  const _borderWidth = (b) => (b && BORDER_WIDTH[b.style]) || 0;
  const _lineWidth = (b, scale) => (_borderWidth(b) || 0.5) * scale;
  const _pageSize = (size) => {
    if (Array.isArray(size)) return { w: size[0], h: size[1] };
    return PAGE_DIMS[size] || PAGE_DIMS.A3;
  };

  const effectiveMargin = Math.max(pdfConfig.margin, 28.35);

    // ── Per-sheet layout: sections + natural content width/height ─────────────
  // Last row that actually carries content (a value, border, fill, or template
  // image) — the VAR sheets keep ~26 phantom empty trailing rows past their
  // real content, which inflate the fit-height and shrink the whole grid.
  const _lastUsedRow = (sheet, maxRow) => {
    let used = 0;
    sheet.eachRow({ includeEmpty: true }, (row, rn) => {
      if (rn > maxRow) return;
      let rowUsed = false;
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        if (cn > 33) return;
        const hasValue = cell.value !== null && cell.value !== undefined && cell.value !== '';
        const hasBorder = !!(cell.border && (cell.border.top || cell.border.bottom
          || cell.border.left || cell.border.right));
        const hasFill = !!(cell.fill && cell.fill.type && cell.fill.fgColor
          && cell.fill.fgColor.argb);
        if (hasValue || hasBorder || hasFill) rowUsed = true;
      });
      if (rowUsed) used = rn;
    });
    // VAR 1 restores its template artwork (top logo rows 2-6, QR graphic rows
    // 61-63), so rows spanned by those anchors count as used too.
    if (reportType === 'var1') {
      for (const img of attractionTemplateImages) used = Math.max(used, img.br.row);
    }
    return used;
  };

  const layouts = sheets.map(sheet => {
    const maxCol = reportType === 'var2' || reportType === 'var1' ? 18 : 33;
    const maxRow = (reportType === 'dae' && variant === 'daily')
      ? 181
      : (sheet.rowCount || 197);
    const usedRow = (reportType === 'var2' || reportType === 'var1')
      ? Math.min(maxRow, _lastUsedRow(sheet, maxRow))
      : maxRow;

    const rows = [];
    sheet.eachRow({ includeEmpty: true }, (row, rn) => {
      if (rn > maxRow) return;
      rows.push({ row, rn });
    });

    const breaks = [1, ...pdfConfig.breakRows, Infinity];
    const sheetSections = [];
    for (let s = 0; s < breaks.length - 1; s++) {
      const lo = breaks[s];
      const hi = breaks[s + 1];
      const section = rows.filter(r => r.rn >= lo && r.rn < hi);
      if (section.length > 0) sheetSections.push(section);
    }

    // Excel's real column width = units × max-digit-width + 5px padding.
    let contentWidthPt = 0;
    for (let c = 1; c <= maxCol; c++) {
      const w = sheet.getColumn(c).width;
      if (w != null && w > 0) contentWidthPt += w * CHAR_WIDTH_PT + CELL_PAD_PT;
    }
    if (contentWidthPt === 0) contentWidthPt = 40 * (CHAR_WIDTH_PT + CELL_PAD_PT);

    let maxHeightInAnySection = 0;
    for (const sec of sheetSections) {
      let h = 0;
      for (const { row, rn } of sec) {
        if (rn > usedRow) break;
        h += (row.height || 15);
      }
      if (h > maxHeightInAnySection) maxHeightInAnySection = h;
    }
    if (maxHeightInAnySection === 0) maxHeightInAnySection = 300;

    return { sheet, maxCol, sheetSections, contentWidthPt, maxHeightInAnySection, usedRow };
  });

  // ── Page geometry per sheet ───────────────────────────────────────────────
  // Every sheet is placed on a fixed standard page (A4 in the configured
  // orientation, or the caller's page on print) and scaled down by a single
  // uniform factor so it fits inside the margins.  A single scale factor for
  // width and height keeps the table's aspect ratio intact — never distorted —
  // and centers it on the page, so nothing ever overflows the page.
  const ps  = _pageSize(pdfConfig.size);
  const pgW = pdfConfig.layout === 'landscape' ? ps.h : ps.w;
  const pgH = pdfConfig.layout === 'landscape' ? ps.w : ps.h;
  const aw2 = pgW - 2 * effectiveMargin;
  const ah2 = pgH - 2 * effectiveMargin;

  const geometries = layouts.map(L => {
    const scale = Math.min(aw2 / L.contentWidthPt, ah2 / L.maxHeightInAnySection);
    return {
      pageSize: pdfConfig.size,
      layout: pdfConfig.layout,
      scale,
      originX: effectiveMargin + (aw2 - L.contentWidthPt * scale) / 2,
      originY: effectiveMargin,
    };
  });

  const doc = new PDFDocument({
    layout: geometries[0].layout,
    size:   geometries[0].pageSize,
    margin: effectiveMargin,
  });

  // Collect PDF output into a buffer
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const pdfPromise = new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  let isFirstSheet = true;

  // Convert a two-cell image anchor into PDF-space box coordinates using the
  // same column-width/row-height math as the cell grid (EMU → pt × scale).
  const _pdfImageBox = (sheet, tl, br, scale, originX, originY) => {
    const px = (emu) => (emu / 914400) * 72;
    let x = originX;
    for (let c = 1; c <= tl.col; c++) {
      x += ((sheet.getColumn(c).width || 10) * CHAR_WIDTH_PT + CELL_PAD_PT) * scale;
    }
    x += px(tl.colOff) * scale;
    let y = originY;
    for (let r = 1; r <= tl.row; r++) {
      y += (sheet.getRow(r).height || 15) * scale;
    }
    y += px(tl.rowOff) * scale;
    let boxW = 0;
    for (let c = tl.col + 1; c <= br.col; c++) {
      boxW += ((sheet.getColumn(c).width || 10) * CHAR_WIDTH_PT + CELL_PAD_PT) * scale;
    }
    boxW += px(br.colOff - tl.colOff) * scale;
    let boxH = 0;
    for (let r = tl.row + 1; r <= br.row; r++) {
      boxH += (sheet.getRow(r).height || 15) * scale;
    }
    boxH += px(br.rowOff - tl.rowOff) * scale;
    return { x, y, boxW, boxH };
  };

  for (let si = 0; si < layouts.length; si++) {
    const { sheet, maxCol, sheetSections, usedRow } = layouts[si];
    const geo = geometries[si];
    const { originX, originY, scale } = geo;

    if (!isFirstSheet) {
      doc.addPage({ layout: geo.layout, size: geo.pageSize, margin: effectiveMargin });
    }
    isFirstSheet = false;

    for (let s = 0; s < sheetSections.length; s++) {
      const section = sheetSections[s];
      if (s > 0) {
        doc.addPage({ layout: geo.layout, size: geo.pageSize, margin: effectiveMargin });
      }

      let curY = originY;

      for (const { row, rn } of section) {
        // Skip phantom empty trailing rows beyond the sheet's real content.
        if (rn > usedRow) continue;
        const rh = (row.height || 15) * scale;
        let curX = originX;

        // Pass 1: draw every cell's fill, border, and (if applicable) checkmark,
        // and record its box + text for pass 2. Text is drawn in a separate pass
        // AFTER every cell in the row has its background painted, so that text
        // spilling out of its own cell into a blank neighbor never gets papered
        // over by that neighbor's fill/border being drawn later.
        const cellBlocks = [];

        row.eachCell({ includeEmpty: true }, (cell, cn) => {
          if (cn > maxCol) return;

          const cw = (sheet.getColumn(cn).width || 10) * CHAR_WIDTH_PT * scale + CELL_PAD_PT * scale;

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
              for (let c = mr.left; c <= mr.right; c++) bw += (sheet.getColumn(c).width || 10) * CHAR_WIDTH_PT * scale + CELL_PAD_PT * scale;
              bh = 0;
              for (let r = mr.top; r <= mr.bottom; r++) bh += (sheet.getRow(r).height || 15) * scale;
            }
          }

          if (cell.fill?.fgColor?.argb) {
            doc.rect(curX, curY, bw, bh)
               .fill('#' + cell.fill.fgColor.argb.substring(2));
          }

          if (cell.isMerged) {
            const mr = _findMergeRange(sheet, cell.address);
            let tW = 0, bW = 0, lW = 0, rW = 0;
            if (mr) {
              for (let c = mr.left; c <= mr.right; c++) {
                tW = Math.max(tW, _borderWidth(sheet.getCell(mr.top, c).border?.top));
                bW = Math.max(bW, _borderWidth(sheet.getCell(mr.bottom, c).border?.bottom));
              }
              for (let r = mr.top; r <= mr.bottom; r++) {
                lW = Math.max(lW, _borderWidth(sheet.getCell(r, mr.left).border?.left));
                rW = Math.max(rW, _borderWidth(sheet.getCell(r, mr.right).border?.right));
              }
            }
            if (tW || bW || lW || rW) {
              doc.strokeColor('#000000');
              if (tW) { doc.lineWidth(tW * scale); doc.moveTo(curX, curY).lineTo(curX + bw, curY).stroke(); }
              if (bW) { doc.lineWidth(bW * scale); doc.moveTo(curX, curY + bh).lineTo(curX + bw, curY + bh).stroke(); }
              if (lW) { doc.lineWidth(lW * scale); doc.moveTo(curX, curY).lineTo(curX, curY + bh).stroke(); }
              if (rW) { doc.lineWidth(rW * scale); doc.moveTo(curX + bw, curY).lineTo(curX + bw, curY + bh).stroke(); }
            }
          } else if (cell.border) {
            doc.strokeColor('#000000');
            if (cell.border.top)    { doc.lineWidth(_lineWidth(cell.border.top, scale));    doc.moveTo(curX, curY).lineTo(curX + bw, curY).stroke(); }
            if (cell.border.bottom) { doc.lineWidth(_lineWidth(cell.border.bottom, scale)); doc.moveTo(curX, curY + bh).lineTo(curX + bw, curY + bh).stroke(); }
            if (cell.border.left)   { doc.lineWidth(_lineWidth(cell.border.left, scale));   doc.moveTo(curX, curY).lineTo(curX, curY + bh).stroke(); }
            if (cell.border.right)  { doc.lineWidth(_lineWidth(cell.border.right, scale));  doc.moveTo(curX + bw, curY).lineTo(curX + bw, curY + bh).stroke(); }
          }

          let text = '';
          if (cell.value?.richText) {
            text = cell.value.richText.map(rt => rt.text).join('');
          } else if (cell.value !== null && cell.value !== undefined) {
            if (typeof cell.value === 'object') {
              if (cell.value.text !== undefined && cell.value.text !== null) {
                text = cell.value.text.toString();
              } else if (cell.value.result !== undefined && cell.value.result !== null) {
                // A formula result may itself be an ExcelJS error object
                // (e.g. AVERAGE over empty cells -> { error: "#DIV/0!" }).
                // Render error results as 0 so totals/ratios never show junk.
                const res = cell.value.result;
                text = (res && typeof res === 'object' && res.error !== undefined)
                  ? '0'
                  : res.toString();
              } else if (cell.value.formula || cell.value.sharedFormula) {
                // Formula (and shared-formula) cells with no cached result
                // default to 0 so totals/subtotals never render blank.
                text = '0';
              } else if (cell.value instanceof Date) {
                text = cell.value.toLocaleDateString();
              } else if (cell.value.error !== undefined) {
                // Bare error cells (no formula/result wrapper) default to 0.
                text = '0';
              } else {
                text = cell.value.toString();
              }
            } else {
              text = cell.value.toString();
            }
          }

          const isCheckmark = text === '\u2714';
          if (isCheckmark) {
            const cx = curX + bw / 2;
            const cy = curY + bh / 2;
            const s  = Math.min(bw, bh) * 0.35;
            const color = cell.font?.color?.argb
              ? '#' + cell.font.color.argb.substring(2)
              : '#000000';
            doc.fillColor(color)
               .lineWidth(1.5 * scale)
               .moveTo(cx - s * 0.5, cy - s * 0.05)
               .lineTo(cx - s * 0.1, cy + s * 0.4)
               .lineTo(cx + s * 0.6, cy - s * 0.3)
               .stroke();
          }

          cellBlocks.push({ cn, x: curX, bw, bh, text, cell, isCheckmark });

          curX += cw;
        });

        // Pass 2: draw text on top of the fully-painted row, mirroring Excel's
        // text layout. Unwrapped text is drawn as single lines positioned by
        // horizontal alignment, so overflow spills into adjacent cells instead
        // of being clipped; embedded '\n' becomes additional stacked lines.
        // Text wraps within the box only when the cell has wrap_text set, and
        // the cell's vertical alignment is honored for both single- and
        // multi-line values.
        for (let i = 0; i < cellBlocks.length; i++) {
          const block = cellBlocks[i];
          if (block.isCheckmark || !block.text) continue;

          const { x, bw, bh, text, cell, cn } = block;
          const fontSize = (cell.font?.size || 7) * scale;
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

          // Alignment: honor an explicit alignment set on the cell; otherwise
          // fall back to Excel's own default rule (numbers right-align, text
          // left-aligns) based on the cell's actual value type. The previous
          // "any column after the first is right-aligned" guess was tuned for
          // the DAE sheets (label in col A, numbers afterward) but wrongly
          // forced the VAR report's establishment-name/code text columns to
          // right-align too, which also made them overflow in the wrong
          // direction (left, into a near-zero-width margin column) instead of
          // rightward into genuinely blank cells.
          const rawValue = cell.value;
          const isNumericValue = typeof rawValue === 'number'
            || (rawValue && typeof rawValue === 'object' && (typeof rawValue.result === 'number' || rawValue.formula || rawValue.sharedFormula));
          const align    = cell.alignment?.horizontal;
          const pdfAlign = align === 'center' ? 'center'
            : align === 'left'  ? 'left'
            : align === 'right' ? 'right'
            : (isNumericValue ? 'right' : 'left');

          const boxX = x + 2;
          const boxW = bw - 4;

          const wrap = !!cell.alignment?.wrap_text;

          const lineH = doc.currentLineHeight();
          let textH;
          if (wrap) {
            textH = doc.heightOfString(text, { width: boxW, lineBreak: true });
          } else {
            textH = String(text).split('\n').length * lineH;
          }
          const valign = cell.alignment?.vertical;
          let textY = curY + 2;
          if (valign === 'center' || valign === 'middle') {
            textY = curY + (bh - textH) / 2;
          } else if (valign === 'bottom') {
            textY = curY + bh - textH - 2;
          }

          if (wrap) {
            doc.text(text, boxX, textY, {
              width: boxW, height: bh - 4, align: pdfAlign, lineBreak: true, ellipsis: false,
            });
          } else {
            // Excel-style overflow: draw each line as a single unwrapped line
            // positioned by its horizontal alignment, so overflowing text
            // spills into adjacent cells (never clipped, never wrapped below).
            let ly = textY;
            for (const ln of String(text).split('\n')) {
              const w = doc.widthOfString(ln);
              let dx = boxX;
              if (pdfAlign === 'center') dx = boxX + (boxW - w) / 2;
              else if (pdfAlign === 'right') dx = boxX + boxW - w;
              doc.text(ln, dx, ly, { width: 0, lineBreak: false, ellipsis: false, align: 'left' });
              ly += lineH;
            }
          }
        }

        curY += rh;
      }

      // Draw the template's own artwork for VAR 1 (attraction) — the top logo
      // and footer graphic — at their original anchor boxes, using the same
      // origin/scale math as the cell grid.  The VAR 2 report keeps drawing the
      // tourism office logo over its header (B1, rows 1-4).
      if (reportType === 'var1') {
        for (const img of attractionTemplateImages) {
          try {
            const { x, y, boxW, boxH } = _pdfImageBox(sheet, img.tl, img.br, scale, geo.originX, geo.originY);
            if (boxW <= 0 || boxH <= 0) continue;
            const imgMeta = doc.openImage(img.buffer);
            const ratio = Math.min(boxW / imgMeta.width, boxH / imgMeta.height);
            doc.image(img.buffer, x, y, { width: imgMeta.width * ratio, height: imgMeta.height * ratio });
          } catch (err) {
            console.warn('[report] Could not draw VAR 1 template image:', err.message);
          }
        }
      } else if (reportType === 'var2' && s === 0 && varLogoBuffer) {
        const colAW = (sheet.getColumn(1).width || 10) * CHAR_WIDTH_PT * scale + CELL_PAD_PT * scale;
        const logoX = originX + colAW + (1038225 / 914400) * 72 * scale;
        const logoY = originY + (57150 / 914400) * 72 * scale;
        const logoPx = 64 * 0.75 * scale;
        doc.image(varLogoBuffer, logoX, logoY, { width: logoPx, height: logoPx });
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