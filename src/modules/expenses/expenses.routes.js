import { Router } from 'express'
import * as expensesController from './expenses.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { hasPermission } from '../../middlewares/role.middleware.js'

const router = Router()

router.use(authenticate)

// ─── EXPENSES ─────────────────────────────────────────────

// View — sab logged-in users dekh sakte hain (jaisa pehle tha)
router.get('/', expensesController.getAll)
router.get('/stats', expensesController.getStats)
router.get('/:id', expensesController.getOne) // single expense (useful to prefill Edit form)

// Create / Update / Delete — SUPER_ADMIN & BRANCH_ADMIN hamesha allowed,
// baaki users (STAFF) ke liye Permission table (EXPENSES module) check hoga
router.post('/', hasPermission('EXPENSES', 'create'), expensesController.create)
router.put('/:id', hasPermission('EXPENSES', 'edit'), expensesController.update)
router.delete('/:id', hasPermission('EXPENSES', 'delete'), expensesController.remove)

export default router