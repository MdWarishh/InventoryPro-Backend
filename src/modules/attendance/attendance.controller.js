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

// ─── NEW: User — mark leave ───────────────────────────────────

export const markLeave = async (req, res) => {
  const { date, notes } = req.body

  if (!date) {
    return res.status(400).json({ success: false, message: 'date is required.' })
  }

  const record = await attendanceService.markLeave(
    req.user.id,
    req.user.branchId,
    date,
    notes,
  )
  sendSuccess(res, record, 'Leave marked successfully.')
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

// ─── NEW: Super Admin — edit attendance record ────────────────

export const editAttendance = async (req, res) => {
  // Sirf SUPER_ADMIN edit kar sakta hai
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, message: 'Only Super Admin can edit attendance records.' })
  }

  const { id } = req.params
  const { checkInTime, checkOutTime, status, notes } = req.body

  const record = await attendanceService.editAttendance(id, {
    checkInTime,
    checkOutTime,
    status,
    notes,
  })

  sendSuccess(res, record, 'Attendance updated successfully.')
}