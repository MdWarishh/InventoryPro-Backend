import prisma from '../../config/db.js'
import {
  toDateOnlyIST,
  hoursBetween,
  timeStrToMinutes,
  getISTMinutesOfDay,
  monthRangeIST,
} from '../../utils/dateUtils.js'

// ─── status logic (per-user threshold now, not hardcoded 8) ───

const deriveStatus = (totalHours, minimumWorkingHours) => {
  if (totalHours === null || totalHours === undefined) return 'ABSENT'
  const threshold = minimumWorkingHours ?? 8 // fallback if nothing configured anywhere
  if (totalHours >= threshold) return 'PRESENT'
  return 'HALF_DAY'
}

// ─── resolve the "effective" working-hours rule for a user ────
// Priority: user's assigned Shift  >  branch AttendanceSettings  >  null (no restriction)

const getEffectiveRule = async (userId, branchId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { shift: true },
  })

  if (user?.shift?.isActive) {
    return {
      shiftId: user.shift.id,
      minimumWorkingHours: user.shift.minimumWorkingHours,
      checkInTime: user.shift.checkInTime,
      checkOutTime: user.shift.checkOutTime,
      gracePeriodMinutes: user.shift.gracePeriodMinutes,
      source: 'shift',
    }
  }

  const settings = await prisma.attendanceSettings.findUnique({ where: { branchId } })
  return {
    shiftId: null,
    minimumWorkingHours: settings?.minimumWorkingHours ?? null,
    checkInTime: settings?.workStartTime ?? null,
    checkOutTime: settings?.workEndTime ?? null,
    gracePeriodMinutes: 15,
    source: 'branch-settings',
  }
}

// ─── attendance settings (branch-level fallback) ───────────────

export const getAttendanceSettings = async (branchId) => {
  return prisma.attendanceSettings.findUnique({ where: { branchId } })
}

export const upsertAttendanceSettings = async (branchId, data) => {
  return prisma.attendanceSettings.upsert({
    where: { branchId },
    update: {
      minimumWorkingHours: data.minimumWorkingHours ?? null,
      workStartTime: data.workStartTime ?? null,
      workEndTime: data.workEndTime ?? null,
    },
    create: {
      branchId,
      minimumWorkingHours: data.minimumWorkingHours ?? null,
      workStartTime: data.workStartTime ?? null,
      workEndTime: data.workEndTime ?? null,
    },
  })
}

// ─── Shift management (admin) ──────────────────────────────────

export const createShift = async (branchId, data) => {
  return prisma.shift.create({
    data: {
      branchId,
      name: data.name,
      minimumWorkingHours: data.minimumWorkingHours,
      checkInTime: data.checkInTime,
      checkOutTime: data.checkOutTime ?? null,
      gracePeriodMinutes: data.gracePeriodMinutes ?? 15,
    },
  })
}

export const updateShift = async (shiftId, data) => {
  return prisma.shift.update({
    where: { id: shiftId },
    data: {
      name: data.name,
      minimumWorkingHours: data.minimumWorkingHours,
      checkInTime: data.checkInTime,
      checkOutTime: data.checkOutTime,
      gracePeriodMinutes: data.gracePeriodMinutes,
      isActive: data.isActive,
    },
  })
}

export const getShifts = async (branchId) => {
  return prisma.shift.findMany({ where: { branchId }, orderBy: { name: 'asc' } })
}

export const deleteShift = async (shiftId) => {
  return prisma.shift.update({ where: { id: shiftId }, data: { isActive: false } })
}

export const assignShiftToUser = async (userId, shiftId) => {
  return prisma.user.update({
    where: { id: userId },
    data: { shiftId: shiftId || null }, // null = unassign, falls back to branch settings
  })
}

// ─── check-in ────────────────────────────────────────────────

export const checkIn = async (userId, branchId) => {
  const today = toDateOnlyIST()
  const now = new Date()

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  })

  if (existing?.checkInTime) {
    throw { statusCode: 400, message: 'You have already checked in today.' }
  }

  const rule = await getEffectiveRule(userId, branchId)

  let isLate = false
  if (rule.checkInTime) {
    const expectedMins = timeStrToMinutes(rule.checkInTime) + (rule.gracePeriodMinutes ?? 0)
    const actualMins = getISTMinutesOfDay(now)
    isLate = actualMins > expectedMins
  }

  // FIX: status is no longer forced to 'ABSENT' while checked in.
  // 'PRESENT' here is provisional — checkOut() will recompute the
  // real status (PRESENT vs HALF_DAY) based on actual hours worked.
  return prisma.attendance.upsert({
    where: { userId_date: { userId, date: today } },
    update: {
      checkInTime: now,
      status: 'PRESENT',
      checkOutTime: null,
      totalHours: null,
      shiftId: rule.shiftId,
      isLate,
    },
    create: {
      userId,
      branchId,
      date: today,
      checkInTime: now,
      status: 'PRESENT',
      shiftId: rule.shiftId,
      isLate,
    },
  })
}

// ─── check-out ───────────────────────────────────────────────

export const checkOut = async (userId, branchId) => {
  const today = toDateOnlyIST()
  const now = new Date()

  const record = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  })

  if (!record?.checkInTime) {
    throw { statusCode: 400, message: 'You have not checked in today.' }
  }
  if (record.checkOutTime) {
    throw { statusCode: 400, message: 'You have already checked out today.' }
  }

  const rule = await getEffectiveRule(userId, branchId)

  if (rule.minimumWorkingHours) {
    const minMs = rule.minimumWorkingHours * 3_600_000
    const allowedAt = new Date(record.checkInTime.getTime() + minMs)
    if (now < allowedAt) {
      throw {
        statusCode: 400,
        message: `Early checkout not allowed. Checkout available after ${allowedAt.toISOString()}.`,
        allowedAt: allowedAt.toISOString(),
      }
    }
  }

  const totalHours = hoursBetween(record.checkInTime, now)
  const status = deriveStatus(totalHours, rule.minimumWorkingHours)

  return prisma.attendance.update({
    where: { userId_date: { userId, date: today } },
    data: { checkOutTime: now, totalHours, status },
  })
}

// ─── today's status (for logged-in user) ─────────────────────

export const getTodayStatus = async (userId, branchId) => {
  const today = toDateOnlyIST()
  const record = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  })

  const rule = await getEffectiveRule(userId, branchId)

  let allowedCheckoutAt = null
  if (record?.checkInTime && rule.minimumWorkingHours) {
    allowedCheckoutAt = new Date(
      record.checkInTime.getTime() + rule.minimumWorkingHours * 3_600_000,
    ).toISOString()
  }

  return {
    attendance: record ?? null,
    minimumWorkingHours: rule.minimumWorkingHours,
    shiftSource: rule.source, // 'shift' or 'branch-settings' — useful for frontend to show "your shift: X hrs"
    allowedCheckoutAt,
    // true while checked in but not checked out yet — frontend can show "Currently working" instead of relying on status alone
    currentlyCheckedIn: !!(record?.checkInTime && !record?.checkOutTime),
  }
}

// ─── admin: list all attendance (with filters) ────────────────

export const getAllAttendance = async (user, query) => {
  const { startDate, endDate, month, year, userId: filterUserId, branchId, status, page = 1, limit = 50 } = query

  const where = {}

  if (user.role === 'SUPER_ADMIN') {
    if (branchId) where.branchId = branchId
  } else {
    where.branchId = user.branchId
  }

  if (filterUserId) where.userId = filterUserId
  if (status) where.status = status

  if (month && year) {
    const { from, to } = monthRangeIST(Number(year), Number(month))
    where.date = { gte: from, lte: to }
  } else if (startDate && endDate) {
    where.date = { gte: toDateOnlyIST(startDate), lte: toDateOnlyIST(endDate) }
  }

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true, branchId: true } },
        shift: { select: { id: true, name: true, minimumWorkingHours: true } },
      },
      orderBy: [{ date: 'desc' }, { user: { name: 'asc' } }],
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
    prisma.attendance.count({ where }),
  ])

  return { records, total, page: Number(page), limit: Number(limit) }
}

// ─── admin: single user monthly attendance ────────────────────

export const getUserMonthlyAttendance = async (userId, query) => {
  const { month, year } = query
  const m = month ? Number(month) : new Date().getMonth() + 1
  const y = year ? Number(year) : new Date().getFullYear()

  const { from, to } = monthRangeIST(y, m)

  const records = await prisma.attendance.findMany({
    where: { userId, date: { gte: from, lte: to } },
    include: { shift: { select: { id: true, name: true, minimumWorkingHours: true } } },
    orderBy: { date: 'asc' },
  })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, shift: { select: { name: true, minimumWorkingHours: true } } },
  })

  const summary = records.reduce(
    (acc, r) => {
      if (r.status === 'PRESENT') acc.present++
      else if (r.status === 'HALF_DAY') acc.halfDay++
      else if (r.status === 'LEAVE') acc.leave++
      else acc.absent++
      if (r.isLate) acc.lateCount++
      acc.totalHours += r.totalHours ?? 0
      return acc
    },
    { present: 0, halfDay: 0, absent: 0, leave: 0, lateCount: 0, totalHours: 0 },
  )

  return { user, records, summary, month: m, year: y }
}

// ─── admin: branch-wide monthly report (all users, summarized) ─
// Used for the "export attendance report" feature

export const getMonthlyBranchReport = async (branchId, month, year) => {
  const { from, to } = monthRangeIST(Number(year), Number(month))

  const users = await prisma.user.findMany({
    where: { branchId, isActive: true },
    select: { id: true, name: true, email: true, role: true, shift: { select: { name: true, minimumWorkingHours: true } } },
    orderBy: { name: 'asc' },
  })

  const records = await prisma.attendance.findMany({
    where: { branchId, date: { gte: from, lte: to } },
  })

  const byUser = {}
  for (const r of records) {
    if (!byUser[r.userId]) byUser[r.userId] = []
    byUser[r.userId].push(r)
  }

  return users.map((u) => {
    const userRecords = byUser[u.id] ?? []
    const summary = userRecords.reduce(
      (acc, r) => {
        if (r.status === 'PRESENT') acc.present++
        else if (r.status === 'HALF_DAY') acc.halfDay++
        else if (r.status === 'LEAVE') acc.leave++
        else acc.absent++
        if (r.isLate) acc.lateCount++
        acc.totalHours += r.totalHours ?? 0
        return acc
      },
      { present: 0, halfDay: 0, absent: 0, leave: 0, lateCount: 0, totalHours: 0 },
    )
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      shiftName: u.shift?.name ?? 'Default (branch settings)',
      minimumWorkingHours: u.shift?.minimumWorkingHours ?? null,
      ...summary,
    }
  })
}

// ─── admin: export monthly report as CSV (no extra dependency needed) ─

export const buildMonthlyReportCSV = (reportRows, month, year) => {
  const header = [
    'Name', 'Email', 'Role', 'Shift', 'Min Hours/Day',
    'Present', 'Half Day', 'Absent', 'Leave', 'Late Count', 'Total Hours',
  ]
  const lines = [header.join(',')]

  for (const row of reportRows) {
    lines.push(
      [
        row.name,
        row.email,
        row.role,
        row.shiftName,
        row.minimumWorkingHours ?? '',
        row.present,
        row.halfDay,
        row.absent,
        row.leave,
        row.lateCount,
        row.totalHours.toFixed(2),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
  }

  return lines.join('\n')
}

// ─── auto-absent job ──────────────────────────────────────────

export const runAutoAbsent = async () => {
  const today = toDateOnlyIST()

  const activeUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, branchId: true },
  })

  const existingIds = (
    await prisma.attendance.findMany({
      where: { date: today },
      select: { userId: true },
    })
  ).map((r) => r.userId)

  const missing = activeUsers.filter((u) => !existingIds.includes(u.id))

  if (missing.length === 0) return { marked: 0 }

  await prisma.attendance.createMany({
    data: missing.map((u) => ({
      userId: u.id,
      branchId: u.branchId ?? 'unknown',
      date: today,
      status: 'ABSENT',
    })),
    skipDuplicates: true,
  })

  return { marked: missing.length }
}

// ─── Super Admin — edit any attendance record ──────────────────

export const editAttendance = async (attendanceId, payload) => {
  const record = await prisma.attendance.findUnique({ where: { id: attendanceId } })
  if (!record) throw { statusCode: 404, message: 'Attendance record not found.' }

  const checkInTime = payload.checkInTime ? new Date(payload.checkInTime) : record.checkInTime
  const checkOutTime = payload.checkOutTime ? new Date(payload.checkOutTime) : record.checkOutTime

  let totalHours = record.totalHours
  if (checkInTime && checkOutTime) {
    totalHours = hoursBetween(checkInTime, checkOutTime)
  } else if (!checkInTime || !checkOutTime) {
    totalHours = null
  }

  // Use the record's own shift snapshot (or user's current shift) to derive status correctly,
  // rather than a hardcoded 8-hour rule.
  const rule = await getEffectiveRule(record.userId, record.branchId)
  const status = payload.status ?? deriveStatus(totalHours, rule.minimumWorkingHours)

  return prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      checkInTime: payload.checkInTime !== undefined ? (payload.checkInTime ? new Date(payload.checkInTime) : null) : undefined,
      checkOutTime: payload.checkOutTime !== undefined ? (payload.checkOutTime ? new Date(payload.checkOutTime) : null) : undefined,
      totalHours,
      status,
      notes: payload.notes !== undefined ? payload.notes : undefined,
    },
  })
}

// ─── User — mark leave for a specific date ─────────────────────

export const markLeave = async (userId, branchId, date, notes) => {
  const targetDate = toDateOnlyIST(new Date(date))

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: targetDate } },
  })

  if (existing?.checkInTime) {
    throw { statusCode: 400, message: 'Cannot mark leave — you have already checked in on this date.' }
  }

  return prisma.attendance.upsert({
    where: { userId_date: { userId, date: targetDate } },
    update: {
      status: 'LEAVE',
      notes: notes ?? null,
      checkInTime: null,
      checkOutTime: null,
      totalHours: null,
    },
    create: {
      userId,
      branchId,
      date: targetDate,
      status: 'LEAVE',
      notes: notes ?? null,
    },
  })
}