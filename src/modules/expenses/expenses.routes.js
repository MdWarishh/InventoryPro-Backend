import { Router } from 'express'
import * as expensesController from './expenses.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()

router.use(authenticate)

// ─── EXPENSES ─────────────────────────────────────────────

// View (sab logged-in users dekh sakte ya tu chahe to restrict kar)
router.get('/', expensesController.getAll)
router.get('/stats', expensesController.getStats)

// Create / Update / Delete (admin only like dealers)
router.post('/', isAdminOrAbove, expensesController.create)
router.put('/:id', isAdminOrAbove, expensesController.update)
router.delete('/:id', isAdminOrAbove, expensesController.remove)

export default router