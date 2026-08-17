import { Router } from 'express'
import * as dealersController from './dealers.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

// ─── OVERVIEW STATS ── (':id' se PEHLE hona chahiye) ──
router.get('/overview-stats', dealersController.getOverviewStats)

// ─── DEALERS CRUD ─────────────────────────────────────────────────────────────
router.get('/',    dealersController.getAll)
router.get('/:id', dealersController.getById)
router.post('/',               isAdminOrAbove, dealersController.create)
router.put('/:id',             isAdminOrAbove, dealersController.update)
router.delete('/:id',          isAdminOrAbove, dealersController.remove)

// ─── STOCK SUMMARY ────────────────────────────────────────────────────────────
router.get('/:id/stock-summary', dealersController.getStockSummary)

// ─── SERIAL NUMBERS ───────────────────────────────────────────────────────────
router.get('/:id/serials', dealersController.getDealerSerials)

// ─── UNBILLED STOCK (invoice generation ke liye) ──────────────────────────────
// NEW: GET /dealers/:id/unbilled-stock
router.get('/:id/unbilled-stock', isAdminOrAbove, dealersController.getUnbilledStock)
router.get('/:id/assigned-products', dealersController.getAssignedProducts)

// ─── STOCK IN ─────────────────────────────────────────────────────────────────
router.get('/:id/stock-in',  isAdminOrAbove, dealersController.getStockInHistory)
router.post('/:id/stock-in', isAdminOrAbove, dealersController.createStockIn)

router.put('/:id/stock-in/:stockInId',    isAdminOrAbove, dealersController.updateStockIn)
router.delete('/:id/stock-in/:stockInId', isAdminOrAbove, dealersController.deleteStockIn)

// ─── STOCK OUT ────────────────────────────────────────────────────────────────


router.post('/:id/stock-return', isAdminOrAbove, dealersController.createSalesReturn)

// ─── HISTORICAL STOCK ─────────────────────────────────────────────────────────
// Ye lines dealers.routes.js mein existing routes ke saath paste karo
// (stock-return route ke baad)

router.get('/:id/historical-stock',              isAdminOrAbove, dealersController.getHistoricalStock)
router.post('/:id/historical-stock',             isAdminOrAbove, dealersController.addHistoricalStock)
router.delete('/:id/historical-stock/:recordId', isAdminOrAbove, dealersController.deleteHistoricalStock)
router.put('/:id/historical-stock/:recordId', isAdminOrAbove, dealersController.updateHistoricalStock)
// ─── OLD DEALER INVOICES (backward compat — DealerInvoice model) ──────────────
router.get('/:id/invoices',            isAdminOrAbove, dealersController.getInvoices)
router.post('/:id/invoices',           isAdminOrAbove, dealersController.createInvoice)
router.get('/:id/invoices/:invoiceId', isAdminOrAbove, dealersController.getInvoiceById)

// ─── MAIN INVOICES LINKED TO DEALER (Invoice model) ──────────────────────────
// NEW: GET /dealers/:id/main-invoices
router.get('/:id/main-invoices', isAdminOrAbove, dealersController.getMainInvoices)

router.get('/:id/graph', dealersController.getDealerGraph)
router.get('/:id/export-report', isAdminOrAbove, dealersController.exportStockReport)
router.get('/:id/sales-stats', dealersController.getSalesStats)
export default router