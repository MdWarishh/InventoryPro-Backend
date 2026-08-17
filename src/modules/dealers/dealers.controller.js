import * as dealersService from './dealers.service.js'
import { sendSuccess, sendPaginated } from '../../utils/response.js'

// ─── DEALERS CRUD ─────────────────────────────────────────────────────────────

export const getAll = async (req, res) => {
  // Non-admin apna branch hi dekhega
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? req.query.branchId
    : req.user.branchId

  const result = await dealersService.getAllDealers({ ...req.query, branchId })
  sendPaginated(res, result.dealers, result.pagination)
}


export const getById = async (req, res) => {
  const dealer = await dealersService.getDealerById(req.params.id)
  sendSuccess(res, dealer)
}

export const create = async (req, res) => {
  // Non-admin ka branchId auto-set
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? req.body.branchId
    : req.user.branchId

  const dealer = await dealersService.createDealer({ ...req.body, branchId })
  sendSuccess(res, dealer, 'Dealer created successfully.', 201)
}


export const update = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? req.body.branchId
    : req.user.branchId

  const dealer = await dealersService.updateDealer(req.params.id, { ...req.body, branchId })
  sendSuccess(res, dealer, 'Dealer updated successfully.')
}

export const remove = async (req, res) => {
  const result = await dealersService.deleteDealer(req.params.id)
  sendSuccess(res, null, result.message)
}
// ─── STOCK IN ─────────────────────────────────────────────────────────────────

export const createStockIn = async (req, res) => {
  const stockIn = await dealersService.createDealerStockIn(req.params.id, req.body, req.user.id)
  sendSuccess(res, stockIn, 'Stock given to dealer successfully.', 201)
}

export const getStockInHistory = async (req, res) => {
  const result = await dealersService.getDealerStockInHistory(req.params.id, req.query)
  sendSuccess(res, result)
}

// ─── SERIAL NUMBERS ───────────────────────────────────────────────────────────

export const getDealerSerials = async (req, res) => {
  const serials = await dealersService.getDealerSerials(
    req.params.id,
    req.query.productId,
    req.query.branchId,
    req.query.productName   // ✅ manual product ke liye
  )
  sendSuccess(res, serials)
}

// ─── UNBILLED STOCK (for invoice generation) ──────────────────────────────────

export const getUnbilledStock = async (req, res) => {
  const result = await dealersService.getDealerUnbilledStock(req.params.id)
  sendSuccess(res, result)
}

// ─── STOCK SUMMARY ────────────────────────────────────────────────────────────

export const getStockSummary = async (req, res) => {
  const result = await dealersService.getDealerStockSummary(req.params.id)
  sendSuccess(res, result)
}

// ─── OLD DEALER INVOICES (backward compat) ────────────────────────────────────

export const createInvoice = async (req, res) => {
  const invoice = await dealersService.createDealerInvoice(req.params.id, req.body)
  sendSuccess(res, invoice, 'Invoice generated successfully.', 201)
}

export const getInvoices = async (req, res) => {
  const result = await dealersService.getDealerInvoices(req.params.id, req.query)
  sendSuccess(res, result)
}

export const getInvoiceById = async (req, res) => {
  const invoice = await dealersService.getDealerInvoiceById(req.params.id, req.params.invoiceId)
  sendSuccess(res, invoice)
}

// ─── MAIN INVOICES LINKED TO DEALER ──────────────────────────────────────────

export const getMainInvoices = async (req, res) => {
  const result = await dealersService.getDealerMainInvoices(req.params.id, req.query)
  sendSuccess(res, result)
}

export const createSalesReturn = async (req, res) => {
  const stockIn = await dealersService.createDealerSalesReturn(req.params.id, req.body, req.user.id)
  sendSuccess(res, stockIn, 'Sales return recorded successfully.', 201)
}
export const getOverviewStats = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? req.query.branchId
    : req.user.branchId

  const stats = await dealersService.getDealersOverviewStats(branchId)
  sendSuccess(res, stats)
}

// ─── HISTORICAL STOCK ─────────────────────────────────────────────────────────
// Ye functions dealers.controller.js ke bottom mein paste karo

export const addHistoricalStock = async (req, res) => {
  const record = await dealersService.addDealerHistoricalStock(req.params.id, req.body)
  sendSuccess(res, record, 'Historical stock added successfully.', 201)
}

export const getHistoricalStock = async (req, res) => {
  const result = await dealersService.getDealerHistoricalStock(req.params.id, req.query)
  sendSuccess(res, result)
}

export const deleteHistoricalStock = async (req, res) => {
  await dealersService.deleteDealerHistoricalStock(req.params.id, req.params.recordId)
  sendSuccess(res, null, 'Historical stock record deleted.')
}

export const getAssignedProducts = async (req, res) => {
  const result = await dealersService.getDealerAssignedProducts(req.params.id)
  sendSuccess(res, result)
}
export const updateStockIn = async (req, res) => {
  const result = await dealersService.updateDealerStockIn(req.params.id, req.params.stockInId, req.body, req.user)
  sendSuccess(res, result, 'Stock-in record updated successfully.')
}

export const deleteStockIn = async (req, res) => {
  const result = await dealersService.deleteDealerStockIn(req.params.id, req.params.stockInId)
  sendSuccess(res, result, result.message)
}

export const getDealerGraph = async (req, res) => {
  const result = await dealersService.getDealerGraphData(req.params.id)
  sendSuccess(res, result)
}

export const exportStockReport = async (req, res) => {
  const { startDate, endDate } = req.query
  const { workbook, dealerName } = await dealersService.exportDealerStockReportExcel(req.params.id, startDate, endDate)

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=${dealerName.replace(/\s+/g, '_')}_stock_report.xlsx`)

  await workbook.xlsx.write(res)
  res.end()
}

export const getSalesStats = async (req, res) => {
  const result = await dealersService.getDealerSalesStats(req.params.id)
  sendSuccess(res, result)
}

export const updateHistoricalStock = async (req, res) => {
  const record = await dealersService.updateDealerHistoricalStock(req.params.id, req.params.recordId, req.body)
  sendSuccess(res, record, 'Historical stock updated successfully.')
}