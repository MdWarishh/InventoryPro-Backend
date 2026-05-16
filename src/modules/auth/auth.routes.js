import { Router } from 'express'
import * as authController from './auth.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'

const router = Router()

router.post('/login', authController.login)
router.post('/refresh', authController.refresh)
router.post('/logout', authenticate, authController.logout)
router.get('/me', authenticate, authController.me)
router.put('/change-password', authenticate, authController.changePassword)

export default router