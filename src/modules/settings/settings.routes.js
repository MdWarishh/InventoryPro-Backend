import { Router } from 'express'
import * as settingsController from './settings.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isSuperAdmin, isAdminOrAbove } from '../../middlewares/role.middleware.js'
import multer from 'multer'

const router = Router()
router.use(authenticate)

// Separate multer instance per field name — avoids MulterError: Unexpected field
const memStorage = multer.memoryStorage()
const uploadLogo      = multer({ storage: memStorage }).single('logo')
const uploadQR        = multer({ storage: memStorage }).single('qrCode')
const uploadSignature = multer({ storage: memStorage }).single('signature')

router.get('/', isAdminOrAbove, settingsController.get)
router.get('/all', isSuperAdmin, settingsController.getAll)
router.put('/', isAdminOrAbove, settingsController.update)
router.post('/logo',      isAdminOrAbove, uploadLogo,      settingsController.uploadLogo)
router.post('/qr-code',   isAdminOrAbove, uploadQR,        settingsController.uploadQRCode)
router.post('/signature', isAdminOrAbove, uploadSignature, settingsController.uploadAuthorizedSignature)

export default router