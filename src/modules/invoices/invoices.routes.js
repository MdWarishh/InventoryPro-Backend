import { Router } from 'express'
import * as invoicesController from './invoices.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/', invoicesController.getAll)
router.get('/:id', invoicesController.getById)
router.post('/', invoicesController.create)
router.post('/reset-counter', isAdminOrAbove, invoicesController.resetCounter)

export default router