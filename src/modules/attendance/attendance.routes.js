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
router.post('/leave',     attendanceController.markLeave)    // POST /attendance/leave  ← NEW (user apni leave mark kare)

// ── Admin routes ────────────────────────────────────────────
router.get('/',                 isAdminOrAbove, attendanceController.getAll)            // GET  /attendance
router.get('/settings',         isAdminOrAbove, attendanceController.getSettings)       // GET  /attendance/settings
router.put('/settings',         isAdminOrAbove, attendanceController.updateSettings)    // PUT  /attendance/settings
router.post('/auto-absent',     isAdminOrAbove, attendanceController.triggerAutoAbsent) // POST /attendance/auto-absent
router.get('/user/:userId',     isAdminOrAbove, attendanceController.getUserAttendance) // GET  /attendance/user/:id
router.patch('/:id',            isAdminOrAbove, attendanceController.editAttendance)    // PATCH /attendance/:id  ← NEW (super admin edit)

export default router