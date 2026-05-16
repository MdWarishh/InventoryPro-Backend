import { Router } from 'express'
import * as meetingsController from './meetings.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/', meetingsController.getAll)
router.get('/:id', meetingsController.getById)
router.post('/', meetingsController.create)
router.put('/:id', meetingsController.update)
router.delete('/:id', meetingsController.remove)

export default router