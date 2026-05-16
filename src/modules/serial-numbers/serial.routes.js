import { Router } from 'express'
import * as serialController from './serial.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/search', serialController.search)
router.get('/available', serialController.getAvailable)
router.get('/product/:productId', serialController.getByProduct)
router.get('/dealer/:dealerId', serialController.getByDealer)
router.patch('/:id/damage', isAdminOrAbove, serialController.markDamaged)

export default router