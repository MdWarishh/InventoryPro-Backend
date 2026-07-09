import { Router } from 'express'
import * as attendanceController from './attendance.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { isAdminOrAbove } from '../../middlewares/role.middleware.js'

const router = Router()
router.use(authenticate)

// ── User routes (all authenticated users) ──────────────────
router.get('/today',      attendanceController.todayStatus)  // GET  /attendance/today
router.post('/check-in',  attendanceController.checkIn)      // POST /attendance/check-in
router.post('/check-out', attendanceController.checkOut)     // POST /attendance/check-out
router.post('/leave',     attendanceController.markLeave)    // POST /attendance/leave

// ── Admin routes ────────────────────────────────────────────
router.get('/',                 isAdminOrAbove, attendanceController.getAll)            // GET  /attendance
router.get('/settings',         isAdminOrAbove, attendanceController.getSettings)       // GET  /attendance/settings
router.put('/settings',         isAdminOrAbove, attendanceController.updateSettings)    // PUT  /attendance/settings
router.post('/auto-absent',     isAdminOrAbove, attendanceController.triggerAutoAbsent) // POST /attendance/auto-absent
router.get('/user/:userId',     isAdminOrAbove, attendanceController.getUserAttendance) // GET  /attendance/user/:id
router.patch('/:id',            isAdminOrAbove, attendanceController.editAttendance)    // PATCH /attendance/:id  (super admin only, checked inside controller)

// ── NEW: Shift management (admin) ───────────────────────────
router.get('/shifts',           isAdminOrAbove, attendanceController.getShifts)         // GET    /attendance/shifts
router.post('/shifts',          isAdminOrAbove, attendanceController.createShift)       // POST   /attendance/shifts
router.put('/shifts/:id',       isAdminOrAbove, attendanceController.updateShift)       // PUT    /attendance/shifts/:id
router.delete('/shifts/:id',    isAdminOrAbove, attendanceController.deleteShift)       // DELETE /attendance/shifts/:id
router.patch('/user/:userId/shift', isAdminOrAbove, attendanceController.assignShift)   // PATCH  /attendance/user/:userId/shift  { shiftId }

// ── NEW: Monthly report + export ────────────────────────────
router.get('/report/monthly',       isAdminOrAbove, attendanceController.getMonthlyReport)    // GET /attendance/report/monthly?month=&year=
router.get('/report/monthly/export', isAdminOrAbove, attendanceController.exportMonthlyReport) // GET /attendance/report/monthly/export?month=&year= (CSV download)

export default router