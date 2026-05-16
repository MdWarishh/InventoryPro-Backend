import * as serialService from './serial.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getByProduct = async (req, res) => {
  const { productId } = req.params
  const { branchId, status } = req.query
  const serials = await serialService.getSerialsByProduct(productId, branchId, status, req.user)
  sendSuccess(res, serials)
}

export const getAvailable = async (req, res) => {
  const { productId, branchId } = req.query
  if (!productId) return sendSuccess(res, [])
  const serials = await serialService.getAvailableSerials(productId, branchId, req.user)
  sendSuccess(res, serials)
}

export const markDamaged = async (req, res) => {
  await serialService.markSerialDamaged(req.params.id, req.user)
  sendSuccess(res, null, 'Serial number marked as damaged.')
}

export const search = async (req, res) => {
  const { q } = req.query
  if (!q) return sendSuccess(res, [])
  const serials = await serialService.searchSerials(q, req.user)
  sendSuccess(res, serials)
}
export const getByDealer = async (req, res) => {
  const { dealerId } = req.params
  const { productId, branchId } = req.query
  const serials = await serialService.getSerialsByDealer(dealerId, productId, branchId)
  sendSuccess(res, serials)
}