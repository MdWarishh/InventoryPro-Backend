import { Router } from 'express'
import * as usersController from './users.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove, isSuperAdmin } from '../../middlewares/role.middleware.js'

const router = Router()

router.use(authenticate)

// Profile routes — logged-in user khud ke liye (no admin middleware)
router.get('/profile',    usersController.getProfile)
router.put('/profile',    usersController.updateProfile)
router.get('/',             isAdminOrAbove, usersController.getAll)
router.post('/',            isAdminOrAbove, usersController.create)
router.put('/:id',          isAdminOrAbove, usersController.update)
router.delete('/:id',       isSuperAdmin,   usersController.remove)
router.put('/:id/reset-password', isAdminOrAbove, usersController.resetPassword)
router.get('/:id/permissions',    isAdminOrAbove, usersController.getPermissions)


export default router