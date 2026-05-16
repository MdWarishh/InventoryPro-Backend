import { Router } from 'express'
import * as notificationsController from './notifications.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/', notificationsController.getAll)
router.patch('/read-all', notificationsController.markAllRead)
router.patch('/:id/read', notificationsController.markRead)
router.delete('/:id', notificationsController.remove)

export default router