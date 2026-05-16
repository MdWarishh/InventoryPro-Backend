import * as settingsService from './settings.service.js'
import { sendSuccess } from '../../utils/response.js'
import cloudinary from '../../config/cloudinary.js'
import streamifier from 'streamifier'

// Helper: upload buffer to Cloudinary via stream (avoids transformation signing issue)
const uploadBufferToCloudinary = (buffer, folder = 'inventory') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
      (error, result) => {
        if (error) return reject(error)
        resolve(result)
      }
    )
    streamifier.createReadStream(buffer).pipe(stream)
  })
}

export const get = async (req, res) => {
  const settings = await settingsService.getSettings(req.query.branchId || null, req.user)
  sendSuccess(res, settings)
}

export const update = async (req, res) => {
  const settings = await settingsService.updateSettings(
    req.body.branchId || req.query.branchId,
    req.body,
    req.user
  )
  sendSuccess(res, settings, 'Settings updated successfully.')
}

export const uploadLogo = async (req, res) => {
  if (!req.file) {
    const { sendError } = await import('../../utils/response.js')
    return sendError(res, 'Logo file is required.', 400)
  }
  const result = await uploadBufferToCloudinary(req.file.buffer)
  const settings = await settingsService.uploadLogo(
    req.body.branchId || req.query.branchId,
    result.secure_url,
    req.user
  )
  sendSuccess(res, settings, 'Logo uploaded successfully.')
}

export const uploadQRCode = async (req, res) => {
  if (!req.file) {
    const { sendError } = await import('../../utils/response.js')
    return sendError(res, 'QR code file is required.', 400)
  }
  const result = await uploadBufferToCloudinary(req.file.buffer)
  const settings = await settingsService.uploadQRCode(
    req.body.branchId || req.query.branchId,
    result.secure_url,
    req.user
  )
  sendSuccess(res, settings, 'QR code uploaded successfully.')
}

export const uploadAuthorizedSignature = async (req, res) => {
  if (!req.file) {
    const { sendError } = await import('../../utils/response.js')
    return sendError(res, 'Signature file is required.', 400)
  }
  const result = await uploadBufferToCloudinary(req.file.buffer)
  const settings = await settingsService.uploadAuthorizedSignature(
    req.body.branchId || req.query.branchId,
    result.secure_url,
    req.user
  )
  sendSuccess(res, settings, 'Signature uploaded successfully.')
}

export const getAll = async (req, res) => {
  const settings = await settingsService.getAllBranchSettings()
  sendSuccess(res, settings)
}