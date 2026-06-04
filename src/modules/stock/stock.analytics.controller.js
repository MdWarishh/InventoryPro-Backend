import * as analyticsService from './stock.analytics.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getMonthlyRevenue = async (req, res) => {
  const data = await analyticsService.getMonthlyRevenue(req.user, req.query)
  sendSuccess(res, data)
}

export const getYearlyRevenue = async (req, res) => {
  const data = await analyticsService.getYearlyRevenue(req.user, req.query)
  sendSuccess(res, data)
}

export const getBreakdown = async (req, res) => {
  const data = await analyticsService.getBreakdown(req.user, req.query)
  sendSuccess(res, data)
}

export const getSummary = async (req, res) => {
  const data = await analyticsService.getSummary(req.user, req.query)
  sendSuccess(res, data)
}