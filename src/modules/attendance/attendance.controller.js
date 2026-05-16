import * as attendanceService from './attendance.service.js'
import { sendSuccess } from '../../utils/response.js'

// ─── user actions ────────────────────────────────────────────

export const todayStatus = async (req, res) => {
  const data = await attendanceService.getTodayStatus(req.user.id, req.user.branchId)
  sendSuccess(res, data)
}

export const checkIn = async (req, res) => {
  const record = await attendanceService.checkIn(req.user.id, req.user.branchId)
  sendSuccess(res, record, 'Checked in successfully.', 201)
}

export const checkOut = async (req, res) => {
  const record = await attendanceService.checkOut(req.user.id, req.user.branchId)
  sendSuccess(res, record, 'Checked out successfully.')
}

// ─── admin: list all ─────────────────────────────────────────

export const getAll = async (req, res) => {
  const data = await attendanceService.getAllAttendance(req.user, req.query)
  sendSuccess(res, data)
}

// ─── admin: single user calendar ─────────────────────────────

export const getUserAttendance = async (req, res) => {
  const data = await attendanceService.getUserMonthlyAttendance(req.params.userId, req.query)
  sendSuccess(res, data)
}

// ─── admin: attendance settings ──────────────────────────────

export const getSettings = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.query.branchId || req.user.branchId)
    : req.user.branchId
  const settings = await attendanceService.getAttendanceSettings(branchId)
  sendSuccess(res, settings)
}

export const updateSettings = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.body.branchId || req.user.branchId)
    : req.user.branchId
  const settings = await attendanceService.upsertAttendanceSettings(branchId, req.body)
  sendSuccess(res, settings, 'Attendance settings updated successfully.')
}

// ─── admin: run auto-absent manually ─────────────────────────

export const triggerAutoAbsent = async (req, res) => {
  const result = await attendanceService.runAutoAbsent()
  sendSuccess(res, result, `Auto-absent complete. ${result.marked} users marked absent.`)
}