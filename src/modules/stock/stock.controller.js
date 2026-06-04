import * as stockService from './stock.service.js'
import { sendSuccess, sendPaginated } from '../../utils/response.js'

export const stockIn = async (req, res) => {
  const record = await stockService.stockIn(req.body, req.user)
  sendSuccess(res, record, 'Stock in recorded successfully.', 201)
}

export const updateStockIn = async (req, res) => {
  const record = await stockService.updateStockIn(req.params.id, req.body, req.user)
  sendSuccess(res, record, 'Stock-in record updated successfully.')
}

export const deleteStockIn = async (req, res) => {
  const result = await stockService.deleteStockIn(req.params.id, req.user)
  sendSuccess(res, result, result.message)
}

export const stockOut = async (req, res) => {
  const record = await stockService.stockOut(req.body, req.user)
  sendSuccess(res, record, 'Stock out recorded successfully.', 201)
}

export const updateStockOut = async (req, res) => {
  const record = await stockService.updateStockOut(req.params.id, req.body, req.user)
  sendSuccess(res, record, 'Stock-out record updated successfully.')
}

export const deleteStockOut = async (req, res) => {
  const result = await stockService.deleteStockOut(req.params.id, req.user)
  sendSuccess(res, result, result.message)
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