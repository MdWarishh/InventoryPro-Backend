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
  await dealersService.deleteDealer(req.params.id)
  sendSuccess(res, null, 'Dealer deactivated successfully.')
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

// ─── STOCK OUT ────────────────────────────────────────────────────────────────

export const createStockOut = async (req, res) => {
  // productId nahi hai = manual/free-text product → alag flow
  if (!req.body.productId) {
    const result = await dealersService.createDealerManualStockOut(req.params.id, req.body)
    return sendSuccess(res, result, 'Dealer sale recorded successfully.', 201)
  }

  const stockOut = await dealersService.createDealerStockOut(req.params.id, req.body)
  sendSuccess(res, stockOut, 'Dealer sale recorded successfully.', 201)
}

export const getStockOutHistory = async (req, res) => {
  const result = await dealersService.getDealerStockOutHistory(req.params.id, req.query)
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