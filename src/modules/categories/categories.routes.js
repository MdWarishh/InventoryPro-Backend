import { Router } from 'express'
import * as categoriesController from './categories.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/', categoriesController.getAll)
router.post('/', isAdminOrAbove, categoriesController.create)
router.put('/:id', isAdminOrAbove, categoriesController.update)
router.delete('/:id', isAdminOrAbove, categoriesController.remove)

export default router