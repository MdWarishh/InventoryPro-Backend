import { Router } from 'express'
import * as labelsController from './labels.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/', labelsController.getAll)       
router.post('/', isAdminOrAbove, labelsController.create)
router.put('/:id', isAdminOrAbove, labelsController.update)
router.delete('/:id', isAdminOrAbove, labelsController.remove)

export default router