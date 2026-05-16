import * as XLSX from 'xlsx'

export const parseExcelFile = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

export const generateExcelTemplate = (type) => {
  const templates = {
    PRODUCTS: {
      headers: ['name*', 'sku', 'description', 'categoryName', 'unit', 'purchasePrice*', 'sellingPrice*', 'gstRate', 'hsnCode', 'minStockAlert', 'hasSerialNumbers'],
      example: ['Product Name', 'SKU-001', 'Description here', 'Electronics', 'pcs', '500', '800', '18', '8471', '10', 'false']
    },
    STOCK_IN: {
      headers: ['sku*', 'branchName*', 'quantity*', 'purchasePrice*', 'dealerName', 'sourceNote', 'referenceNo', 'date', 'serialNumbers'],
      example: ['SKU-001', 'Main Branch', '50', '500', 'Dealer Name', 'Purchase note', 'REF-001', '2024-01-01', 'SN001,SN002,SN003']
    },
    DEALERS: {
      headers: ['name*', 'phone', 'email', 'address', 'city', 'state', 'gstNumber', 'bankAccount', 'bankName', 'ifscCode'],
      example: ['Dealer Name', '9876543210', 'dealer@email.com', '123 Street', 'Mumbai', 'Maharashtra', '27AAAAA0000A1Z5', '123456789', 'HDFC Bank', 'HDFC0001234']
    },
  }

  const template = templates[type]
  if (!template) throw new Error('Invalid template type')

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([template.headers, template.example])

  ws['!cols'] = template.headers.map(() => ({ wch: 20 }))

  XLSX.utils.book_append_sheet(wb, ws, 'Template')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

export const generateExcelReport = (data, headers, sheetName = 'Report') => {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data, { header: headers })
  ws['!cols'] = headers.map(() => ({ wch: 20 }))
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}