const ExcelJS = require('exceljs');
const path = require('path');
async function analyze() {
  const daeWb = new ExcelJS.Workbook();
  await daeWb.xlsx.readFile(path.join('sample', 'ON Blank Form.xlsx'));
  console.log('=== DAE Template Worksheets ===');
  daeWb.eachSheet((s, i) => {
    console.log('  [' + i + '] "' + s.name + '"');
    console.log('    rows=' + s.rowCount + ' merges=' + Object.keys(s._merges || {}).length);
    var cols = [];
    s.columns.forEach((c, j) => { if (j < 35) cols.push('Col'+(j+1)+'='+c.width); });
    cols.forEach(c => console.log('      ' + c));
  });
  const varWb = new ExcelJS.Workbook();
  await varWb.xlsx.readFile(path.join('sample', 'VAR-REPORT.xlsx'));
  console.log('\n=== VAR Template Worksheets ===');
  varWb.eachSheet((s, i) => {
    console.log('  [' + i + '] "' + s.name + '"');
    console.log('    rows=' + s.rowCount + ' merges=' + Object.keys(s._merges || {}).length);
    var cols = [];
    s.columns.forEach((c, j) => { if (j < 21) cols.push('Col'+(j+1)+'='+c.width); });
    cols.forEach(c => console.log('      ' + c));
  });
  console.log('\n=== Checking VAR worksheet name match ===');
  varWb.eachSheet(s => {
    console.log('  Actual name: "' + s.name + '"');
    console.log('  Match "VAR 2M LGU Month Report": ' + (s.name === 'VAR 2M LGU Month Report'));
  });
  var vts = varWb.getWorksheet('VAR 2M LGU Month Report');
  if (!vts) {
    console.log('\n*** VAR TEMPLATE SHEET NOT FOUND! ***');
    varWb.eachSheet(s => { console.log('  Available sheet: "' + s.name + '"'); });
  } else {
    console.log('\n=== VAR template found, simulating clone ===');
    const nwb = new ExcelJS.Workbook();
    const ns = nwb.addWorksheet('VAR Report');
    vts.columns.forEach((col, i) => { if (col.width) ns.getColumn(i+1).width = col.width; });
    console.log('Cloned column widths (first 20):');
    for (var c = 1; c <= 20; c++) console.log('  Col' + c + ' = ' + ns.getColumn(c).width);
  }
  console.log('\n=== Checking DAE template sheet names ===');
  daeWb.eachSheet(s => {
    console.log('  "' + s.name + '"');
    console.log('    Match "Name of Establishment": ' + (s.name === 'Name of Establishment'));
    console.log('    Match "AE DAE-1B by Country (Sum) ": ' + (s.name === 'AE DAE-1B by Country (Sum) '));
    console.log('    Match "AE DAE-1B (Monthly)": ' + (s.name === 'AE DAE-1B (Monthly)'));
  });
}
analyze().catch(e => console.error(e));
