import * as bulkService from './bulk.service.js'
import { sendSuccess, sendError } from '../../utils/response.js'

export const uploadProducts = async (req, res) => {
  if (!req.file) return sendError(res, 'File is required.', 400)
  const result = await bulkService.bulkUploadProducts(req.file.buffer, req.user)
  sendSuccess(res, result, `Upload complete. Success: ${result.success}, Failed: ${result.failed}`)
}

export const uploadStockIn = async (req, res) => {
  if (!req.file) return sendError(res, 'File is required.', 400)
  const result = await bulkService.bulkUploadStockIn(req.file.buffer, req.user)
  sendSuccess(res, result, `Upload complete. Success: ${result.success}, Failed: ${result.failed}`)
}

export const uploadDealers = async (req, res) => {
  if (!req.file) return sendError(res, 'File is required.', 400)
  const result = await bulkService.bulkUploadDealers(req.file.buffer, req.user)
  sendSuccess(res, result, `Upload complete. Success: ${result.success}, Failed: ${result.failed}`)
}

export const getHistory = async (req, res) => {
  const history = await bulkService.getUploadHistory(req.user)
  sendSuccess(res, history)
}

export const downloadTemplate = async (req, res) => {
  const { type } = req.params
  const validTypes = ['PRODUCTS', 'STOCK_IN', 'DEALERS']
  if (!validTypes.includes(type)) return sendError(res, 'Invalid template type.', 400)

  const buffer = bulkService.getTemplate(type)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${type.toLowerCase()}-template.xlsx"`)
  res.send(buffer)
}