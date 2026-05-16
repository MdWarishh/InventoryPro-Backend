import multer from 'multer'
import { CloudinaryStorage } from 'multer-storage-cloudinary'
import cloudinary from '../config/cloudinary.js'

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'inventory',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit' }],
  },
})

const excelStorage = multer.memoryStorage()

export const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('image')

export const uploadImages = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
}).array('images', 5)

export const uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ]
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Only Excel/CSV files are allowed'), false)
  },
}).single('file')