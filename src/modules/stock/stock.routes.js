import { Router } from 'express'
import * as stockController from './stock.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isSuperAdmin, isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.post('/in', stockController.stockIn)
router.post('/out', stockController.stockOut)
router.get('/current', stockController.getCurrentStock)
router.get('/history/:type', stockController.getHistory)
router.post('/transfer', isSuperAdmin, stockController.transferStock)

export default router