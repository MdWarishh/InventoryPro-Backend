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

// ─── User — mark leave ───────────────────────────────────────

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

// ─── admin: attendance settings (branch-level fallback) ──────

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

// ─── Super Admin — edit attendance record ────────────────────

export const editAttendance = async (req, res) => {
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

// ─── NEW: Shift management (admin) ────────────────────────────
// Solves the "6hr staff vs 9hr staff" problem — each shift carries
// its own minimumWorkingHours + expected check-in time.

export const createShift = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.body.branchId || req.user.branchId)
    : req.user.branchId

  const { name, minimumWorkingHours, checkInTime, checkOutTime, gracePeriodMinutes } = req.body

  if (!name || !minimumWorkingHours || !checkInTime) {
    return res.status(400).json({
      success: false,
      message: 'name, minimumWorkingHours and checkInTime are required.',
    })
  }

  const shift = await attendanceService.createShift(branchId, {
    name, minimumWorkingHours, checkInTime, checkOutTime, gracePeriodMinutes,
  })
  sendSuccess(res, shift, 'Shift created successfully.', 201)
}

export const updateShift = async (req, res) => {
  const shift = await attendanceService.updateShift(req.params.id, req.body)
  sendSuccess(res, shift, 'Shift updated successfully.')
}

export const getShifts = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.query.branchId || req.user.branchId)
    : req.user.branchId
  const shifts = await attendanceService.getShifts(branchId)
  sendSuccess(res, shifts)
}

export const deleteShift = async (req, res) => {
  const shift = await attendanceService.deleteShift(req.params.id)
  sendSuccess(res, shift, 'Shift deactivated successfully.')
}

export const assignShift = async (req, res) => {
  const { userId } = req.params
  const { shiftId } = req.body
  const user = await attendanceService.assignShiftToUser(userId, shiftId)
  sendSuccess(res, user, 'Shift assigned successfully.')
}

// ─── NEW: Admin/Super Admin — monthly branch report ───────────

export const getMonthlyReport = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.query.branchId || req.user.branchId)
    : req.user.branchId

  const month = Number(req.query.month) || new Date().getMonth() + 1
  const year = Number(req.query.year) || new Date().getFullYear()

  const report = await attendanceService.getMonthlyBranchReport(branchId, month, year)
  sendSuccess(res, { report, month, year })
}

// ─── NEW: Admin/Super Admin — export monthly report as CSV ───

export const exportMonthlyReport = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.query.branchId || req.user.branchId)
    : req.user.branchId

  const month = Number(req.query.month) || new Date().getMonth() + 1
  const year = Number(req.query.year) || new Date().getFullYear()

  const report = await attendanceService.getMonthlyBranchReport(branchId, month, year)
  const csv = attendanceService.buildMonthlyReportCSV(report, month, year)

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${year}-${month}.csv"`)
  res.send(csv)
}