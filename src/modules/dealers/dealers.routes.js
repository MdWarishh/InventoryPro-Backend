import { Router } from 'express'
import * as dealersController from './dealers.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

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

// ─── STOCK IN ─────────────────────────────────────────────────────────────────
router.get('/:id/stock-in',  isAdminOrAbove, dealersController.getStockInHistory)
router.post('/:id/stock-in', isAdminOrAbove, dealersController.createStockIn)

// ─── STOCK OUT ────────────────────────────────────────────────────────────────
router.get('/:id/stock-out',  dealersController.getStockOutHistory)
router.post('/:id/stock-out', isAdminOrAbove, dealersController.createStockOut)

router.post('/:id/stock-return', isAdminOrAbove, dealersController.createSalesReturn)

// ─── OLD DEALER INVOICES (backward compat — DealerInvoice model) ──────────────
router.get('/:id/invoices',            isAdminOrAbove, dealersController.getInvoices)
router.post('/:id/invoices',           isAdminOrAbove, dealersController.createInvoice)
router.get('/:id/invoices/:invoiceId', isAdminOrAbove, dealersController.getInvoiceById)

// ─── MAIN INVOICES LINKED TO DEALER (Invoice model) ──────────────────────────
// NEW: GET /dealers/:id/main-invoices
router.get('/:id/main-invoices', isAdminOrAbove, dealersController.getMainInvoices)

export default router