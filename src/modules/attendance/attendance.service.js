import prisma from '../../config/db.js'

// ─── helpers ────────────────────────────────────────────────

const toDateOnly = (d = new Date()) => {
  const dt = new Date(d)
  dt.setUTCHours(0, 0, 0, 0)
  return dt
}

const hoursBetween = (start, end) =>
  Math.round(((end - start) / 3_600_000) * 100) / 100

const deriveStatus = (totalHours) => {
  if (totalHours === null || totalHours === undefined) return 'ABSENT'
  if (totalHours >= 8) return 'PRESENT'
  return 'HALF_DAY'
}

// ─── attendance settings ─────────────────────────────────────

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

// ─── check-in ────────────────────────────────────────────────

export const checkIn = async (userId, branchId) => {
  const today = toDateOnly()
  const now = new Date()

  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  })

  if (existing?.checkInTime) {
    throw { statusCode: 400, message: 'You have already checked in today.' }
  }

  return prisma.attendance.upsert({
    where: { userId_date: { userId, date: today } },
    update: { checkInTime: now, status: 'ABSENT', checkOutTime: null, totalHours: null },
    create: {
      userId,
      branchId,
      date: today,
      checkInTime: now,
      status: 'ABSENT',
    },
  })
}

// ─── check-out ───────────────────────────────────────────────

export const checkOut = async (userId, branchId) => {
  const today = toDateOnly()
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

  const settings = await prisma.attendanceSettings.findUnique({ where: { branchId } })
  if (settings?.minimumWorkingHours) {
    const minMs = settings.minimumWorkingHours * 3_600_000
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
  const status = deriveStatus(totalHours)

  return prisma.attendance.update({
    where: { userId_date: { userId, date: today } },
    data: { checkOutTime: now, totalHours, status },
  })
}

// ─── today's status (for logged-in user) ─────────────────────

export const getTodayStatus = async (userId, branchId) => {
  const today = toDateOnly()
  const record = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: today } },
  })

  const settings = await prisma.attendanceSettings.findUnique({ where: { branchId } })
  const minimumWorkingHours = settings?.minimumWorkingHours ?? null

  let allowedCheckoutAt = null
  if (record?.checkInTime && minimumWorkingHours) {
    allowedCheckoutAt = new Date(
      record.checkInTime.getTime() + minimumWorkingHours * 3_600_000,
    ).toISOString()
  }

  return {
    attendance: record ?? null,
    minimumWorkingHours,
    allowedCheckoutAt,
  }
}

// ─── admin: list all attendance (with filters) ────────────────

export const getAllAttendance = async (user, query) => {
  const { startDate, endDate, month, year, userId: filterUserId, branchId, page = 1, limit = 50 } = query

  const where = {}

  if (user.role === 'SUPER_ADMIN') {
    if (branchId) {
      where.user = { branchId }
    }
  } else {
    where.user = { branchId: user.branchId }
  }

  if (filterUserId) where.userId = filterUserId

  if (month && year) {
    const from = toDateOnly(new Date(year, month - 1, 1))
    const to = toDateOnly(new Date(year, month, 0))
    to.setUTCHours(23, 59, 59, 999)
    where.date = { gte: from, lte: to }
  } else if (startDate && endDate) {
    where.date = { gte: toDateOnly(startDate), lte: toDateOnly(endDate) }
  }

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true, role: true, branchId: true } } },
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

  const from = toDateOnly(new Date(y, m - 1, 1))
  const to = toDateOnly(new Date(y, m, 0))
  to.setUTCHours(23, 59, 59, 999)

  const records = await prisma.attendance.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
  })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  })

  const summary = records.reduce(
    (acc, r) => {
      if (r.status === 'PRESENT') acc.present++
      else if (r.status === 'HALF_DAY') acc.halfDay++
      else acc.absent++
      acc.totalHours += r.totalHours ?? 0
      return acc
    },
    { present: 0, halfDay: 0, absent: 0, totalHours: 0 },
  )

  return { user, records, summary, month: m, year: y }
}

// ─── auto-absent job ──────────────────────────────────────────

export const runAutoAbsent = async () => {
  const today = toDateOnly()

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

// ─── NEW: Super Admin — edit any attendance record ────────────
// Allows changing checkInTime, checkOutTime, status, notes
// totalHours auto-recalculated if both times are present

export const editAttendance = async (attendanceId, payload) => {
  const record = await prisma.attendance.findUnique({ where: { id: attendanceId } })
  if (!record) throw { statusCode: 404, message: 'Attendance record not found.' }

  const checkIn  = payload.checkInTime  ? new Date(payload.checkInTime)  : record.checkInTime
  const checkOut = payload.checkOutTime ? new Date(payload.checkOutTime) : record.checkOutTime

  // Auto-recalculate totalHours if both times exist
  let totalHours = record.totalHours
  if (checkIn && checkOut) {
    totalHours = hoursBetween(checkIn, checkOut)
  } else if (!checkIn || !checkOut) {
    totalHours = null
  }

  // Status: use provided status OR derive from totalHours
  const status = payload.status ?? deriveStatus(totalHours)

  return prisma.attendance.update({
    where: { id: attendanceId },
    data: {
      checkInTime:  payload.checkInTime  !== undefined ? (payload.checkInTime  ? new Date(payload.checkInTime)  : null) : undefined,
      checkOutTime: payload.checkOutTime !== undefined ? (payload.checkOutTime ? new Date(payload.checkOutTime) : null) : undefined,
      totalHours,
      status,
      notes: payload.notes !== undefined ? payload.notes : undefined,
    },
  })
}

// ─── NEW: User — mark leave for a specific date ───────────────
// User sirf apni khud ki leave mark kar sakta hai
// Status sirf 'LEAVE' set hoti hai, kuch aur nahi

export const markLeave = async (userId, branchId, date, notes) => {
  const targetDate = toDateOnly(new Date(date))
  const today = toDateOnly()

  // Past ya future dates allow karo, but aaj ke liye check karo agar already checked in
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId, date: targetDate } },
  })

  // Agar already check-in ho chuka hai toh leave nahi lagegi
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