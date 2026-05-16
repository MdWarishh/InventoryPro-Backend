import * as reportsService from './reports.service.js'
import { sendSuccess, sendError } from '../../utils/response.js'

export const getDashboard = async (req, res) => {
  const stats = await reportsService.getDashboardStats(req.user, req.query.branchId)
  sendSuccess(res, stats)
}

export const getSales = async (req, res) => {
  const result = await reportsService.getSalesReport(req.user, req.query)
  sendSuccess(res, result)
}

export const getPurchase = async (req, res) => {
  const result = await reportsService.getPurchaseReport(req.user, req.query)
  sendSuccess(res, result)
}

export const getStockValuation = async (req, res) => {
  const result = await reportsService.getStockValuationReport(req.user, req.query.branchId)
  sendSuccess(res, result)
}

export const getAllBranches = async (req, res) => {
  const result = await reportsService.getAllBranchesReport(req.user, req.query)
  sendSuccess(res, result)
}

export const getGST = async (req, res) => {
  const { month, year, type, branchId } = req.query
  if (!month || !year) return sendError(res, 'Month and year are required.', 400)
  const result = await reportsService.getGSTReport(req.user, {
    branchId,
    month: Number(month),
    year: Number(year),
    type,
  })
  sendSuccess(res, result)
}

export const getLowStock = async (req, res) => {
  const result = await reportsService.getLowStockReport(req.user, req.query.branchId)
  sendSuccess(res, result)
}

export const download = async (req, res) => {
  const { reportType, ...filters } = req.query
  if (!reportType) return sendError(res, 'reportType is required.', 400)

  const buffer = await reportsService.downloadReport(req.user, reportType, filters)

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${reportType}-report-${Date.now()}.xlsx"`)
  res.send(buffer)
}