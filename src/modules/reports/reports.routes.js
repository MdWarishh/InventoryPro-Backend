import { Router } from 'express'
import * as reportsController from './reports.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isSuperAdmin, isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/dashboard', reportsController.getDashboard)
router.get('/sales', isAdminOrAbove, reportsController.getSales)
router.get('/purchase', isAdminOrAbove, reportsController.getPurchase)
router.get('/stock-valuation', isAdminOrAbove, reportsController.getStockValuation)
router.get('/all-branches', isSuperAdmin, reportsController.getAllBranches)
router.get('/gst', isAdminOrAbove, reportsController.getGST)
router.get('/low-stock', isAdminOrAbove, reportsController.getLowStock)
router.get('/download', isAdminOrAbove, reportsController.download)

export default router