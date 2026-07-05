import { Router } from 'express'
import * as stockController from './stock.controller.js'
import * as analyticsController from './stock.analytics.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isSuperAdmin, isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

// ── Stock In ──────────────────────────────────────────────────────────────────
router.post('/in', stockController.stockIn)
router.put('/in/:id', stockController.updateStockIn)
router.patch('/in/:id/remove-unsold', stockController.removeUnsoldFromStockInController)
router.delete('/in/:id', isAdminOrAbove, stockController.deleteStockIn)

// ── Stock Out ─────────────────────────────────────────────────────────────────
router.post('/out', stockController.stockOut)
router.put('/out/:id', stockController.updateStockOut)
router.delete('/out/:id', isAdminOrAbove, stockController.deleteStockOut)

// ── Misc ──────────────────────────────────────────────────────────────────────
router.get('/current', stockController.getCurrentStock)
router.get('/products-in-stock', stockController.getProductsWithStock)   
router.get('/history/:type', stockController.getHistory)
router.post('/transfer', isSuperAdmin, stockController.transferStock)

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get('/analytics/monthly',   analyticsController.getMonthlyRevenue)
router.get('/analytics/yearly',    analyticsController.getYearlyRevenue)
router.get('/analytics/breakdown', analyticsController.getBreakdown)
router.get('/analytics/summary',   analyticsController.getSummary)

export default router