import * as XLSX from 'xlsx'

// Shared Excel export for the Tax Center (Schedule E, Schedule E compare, Form
// 8582). A "block" is one worksheet: caption rows (Property / Tax year / Form),
// a blank spacer, the column header row, the data rows, and an optional total
// row. Numbers stay numeric so a preparer can sum them; strings such as Schedule
// E line numbers stay text so they never render as currency.

function blockToSheet({ meta = [], headers = [], rows = [], total = null }) {
  const aoa = []
  meta.forEach(([label, value]) => aoa.push([label, value]))
  if (meta.length) aoa.push([])
  aoa.push(headers)
  rows.forEach((row) => aoa.push(row))
  if (total) aoa.push(total)

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Column widths sized to the longest cell in each column (capped).
  const colCount = aoa.reduce((max, row) => Math.max(max, row.length), headers.length)
  ws['!cols'] = Array.from({ length: colCount }, (_, c) => {
    let width = 10
    aoa.forEach((row) => {
      const len = String(row[c] ?? '').length + 2
      if (len > width) width = len
    })
    return { wch: Math.min(width, 44) }
  })

  // Currency number format on every numeric cell.
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; R += 1) {
    for (let C = range.s.c; C <= range.e.c; C += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell && typeof cell.v === 'number') cell.z = '$#,##0'
    }
  }
  return ws
}

const safeSheetName = (name, index) =>
  (String(name || `Sheet ${index + 1}`).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31)) || `Sheet ${index + 1}`

// sheets: [{ name, meta, headers, rows, total }]. filename may omit the extension.
export function exportTaxWorkbook(filename, sheets) {
  const list = Array.isArray(sheets) ? sheets : [sheets]
  const workbook = XLSX.utils.book_new()
  list.forEach((sheet, index) => {
    XLSX.utils.book_append_sheet(workbook, blockToSheet(sheet), safeSheetName(sheet.name, index))
  })
  const name = String(filename || 'PropertyLens_Tax_Export')
  XLSX.writeFile(workbook, name.endsWith('.xlsx') ? name : `${name}.xlsx`)
}
