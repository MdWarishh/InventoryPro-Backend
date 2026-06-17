import * as reportsService from './reports.service.js'
import { sendSuccess, sendError } from '../../utils/response.js'

export const getDashboard = async (req, res) => {
  try {
    const stats = await reportsService.getDashboardStats(req.user, req.query.branchId)
    sendSuccess(res, stats)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch dashboard stats', err.statusCode || 500)
  }
}

export const getSales = async (req, res) => {
  try {
    const result = await reportsService.getSalesReport(req.user, req.query)
    sendSuccess(res, result)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch sales report', err.statusCode || 500)
  }
}

export const getPurchase = async (req, res) => {
  try {
    const result = await reportsService.getPurchaseReport(req.user, req.query)
    sendSuccess(res, result)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch purchase report', err.statusCode || 500)
  }
}

export const getStockValuation = async (req, res) => {
  try {
    const result = await reportsService.getStockValuationReport(req.user, req.query.branchId)
    sendSuccess(res, result)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch stock valuation', err.statusCode || 500)
  }
}

export const getAllBranches = async (req, res) => {
  try {
    const result = await reportsService.getAllBranchesReport(req.user, req.query)
    sendSuccess(res, result)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch branches report', err.statusCode || 500)
  }
}

export const getGST = async (req, res) => {
  try {
    const { month, year, type, branchId } = req.query
    if (!month || !year) return sendError(res, 'Month and year are required.', 400)
    const result = await reportsService.getGSTReport(req.user, {
      branchId,
      month: Number(month),
      year: Number(year),
      type,
    })
    sendSuccess(res, result)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch GST report', err.statusCode || 500)
  }
}

export const getLowStock = async (req, res) => {
  try {
    const result = await reportsService.getLowStockReport(req.user, req.query.branchId)
    sendSuccess(res, result)
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch low stock report', err.statusCode || 500)
  }
}

export const download = async (req, res) => {
  try {
    const { reportType, ...filters } = req.query
    if (!reportType) return sendError(res, 'reportType is required.', 400)

    const buffer = await reportsService.downloadReport(req.user, reportType, filters)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${reportType}-report-${Date.now()}.xlsx"`)
    res.send(buffer)
  } catch (err) {
    sendError(res, err.message || 'Failed to download report', err.statusCode || 500)
  }
}