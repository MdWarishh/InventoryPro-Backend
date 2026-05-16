import * as stockService from './stock.service.js'
import { sendSuccess, sendPaginated } from '../../utils/response.js'

export const stockIn = async (req, res) => {
  const record = await stockService.stockIn(req.body, req.user)
  sendSuccess(res, record, 'Stock in recorded successfully.', 201)
}

export const stockOut = async (req, res) => {
  const record = await stockService.stockOut(req.body, req.user)
  sendSuccess(res, record, 'Stock out recorded successfully.', 201)
}

export const getHistory = async (req, res) => {
  const result = await stockService.getStockHistory(req.user, { ...req.query, type: req.params.type })
  sendPaginated(res, result.items, result.pagination)
}

export const getCurrentStock = async (req, res) => {
  const stock = await stockService.getCurrentStock(req.user, req.query)
  sendSuccess(res, stock)
}

export const transferStock = async (req, res) => {
  const transfer = await stockService.transferStock(req.body, req.user)
  sendSuccess(res, transfer, 'Stock transferred successfully.', 201)
}