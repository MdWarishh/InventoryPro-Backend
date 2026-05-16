import { Router } from 'express'
import * as productsController from './products.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'
import { uploadImages } from '../../middlewares/upload.middleware.js'

const router = Router()
router.use(authenticate)

router.get('/search', productsController.search)
router.get('/', productsController.getAll)
router.get('/:id', productsController.getById)
router.post('/', isAdminOrAbove, uploadImages, productsController.create)
router.put('/:id', isAdminOrAbove, uploadImages, productsController.update)
router.delete('/:id', isAdminOrAbove, productsController.remove)

export default router