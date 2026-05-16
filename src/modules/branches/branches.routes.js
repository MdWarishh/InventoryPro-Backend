import { Router } from 'express'
import * as branchesController from './branches.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isSuperAdmin, isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()

router.use(authenticate)

router.get('/', branchesController.getAll)
router.get('/:id', isAdminOrAbove, branchesController.getById)
router.get('/:id/stats', isAdminOrAbove, branchesController.getStats)
router.post('/', isSuperAdmin, branchesController.create)
router.put('/:id', isSuperAdmin, branchesController.update)
router.delete('/:id', isSuperAdmin, branchesController.remove)

export default router