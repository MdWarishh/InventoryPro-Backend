import { Router } from 'express'
import * as bulkController from './bulk.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'
import { uploadExcel } from '../../middlewares/upload.middleware.js'

const router = Router()
router.use(authenticate, isAdminOrAbove)

router.get('/history', bulkController.getHistory)
router.get('/template/:type', bulkController.downloadTemplate)
router.post('/products', uploadExcel, bulkController.uploadProducts)
router.post('/stock-in', uploadExcel, bulkController.uploadStockIn)
router.post('/dealers', uploadExcel, bulkController.uploadDealers)

export default router