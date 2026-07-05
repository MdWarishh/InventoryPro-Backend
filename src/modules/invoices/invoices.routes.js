import { Router } from 'express'
import * as invoicesController from './invoices.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/',    invoicesController.getAll)
router.post('/',   invoicesController.create)
router.post('/reset-counter', isAdminOrAbove, invoicesController.resetCounter)
router.get('/next-number', invoicesController.getNextNumber)
router.get('/:id',    invoicesController.getById)
router.put('/:id',    isAdminOrAbove, invoicesController.update)
router.delete('/:id', isAdminOrAbove, invoicesController.remove)
export default router