import prisma from '../../config/db.js'

// ─── helpers ─────────────────────────────────────────────────

const userSelect = {
  id: true, name: true, email: true, role: true, branchId: true,
}

// Score = completed tasks count (branch ke andar)
const computeScore = (completedCount) => completedCount

// ─── CREATE TASK ──────────────────────────────────────────────
// Admin: kisi bhi user ko assign kar sakta hai (ASSIGNED type)
// User: sirf apna personal task bana sakta hai (PERSONAL type)

export const createTask = async (creatorUser, payload) => {
  const { title, description, priority, dueDate, assignedTo, type } = payload

  const isAdmin = creatorUser.role === 'SUPER_ADMIN' || creatorUser.role === 'BRANCH_ADMIN'

  // Non-admin sirf personal task bana sakta hai
  const taskType = isAdmin && assignedTo && assignedTo !== creatorUser.id
    ? 'ASSIGNED'
    : 'PERSONAL'

  const targetUserId = taskType === 'ASSIGNED' ? assignedTo : creatorUser.id

  // Branch admin sirf apni branch ke users ko assign kar sakta hai
  if (creatorUser.role === 'BRANCH_ADMIN' && taskType === 'ASSIGNED') {
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } })
    if (!targetUser || targetUser.branchId !== creatorUser.branchId) {
      throw { statusCode: 403, message: 'You can only assign tasks to users in your branch.' }
    }
  }

  const task = await prisma.task.create({
    data: {
      title,
      description: description ?? null,
      priority: priority ?? 'MEDIUM',
      dueDate: dueDate ? new Date(dueDate) : null,
      type: taskType,
      createdBy: creatorUser.id,
      assignedTo: targetUserId,
      branchId: creatorUser.branchId ?? null,
      status: 'TODO',
    },
    include: {
      createdByUser: { select: userSelect },
      assignedToUser: { select: userSelect },
    },
  })

  // Activity log
  await prisma.taskActivity.create({
    data: {
      taskId: task.id,
      userId: creatorUser.id,
      action: taskType === 'ASSIGNED'
        ? `Task assigned to ${task.assignedToUser.name}`
        : 'Task created',
    },
  })

  return task
}

// ─── GET MY TASKS ─────────────────────────────────────────────
// Returns: { assigned: [], personal: [] }

export const getMyTasks = async (userId, query) => {
  const { status, priority } = query

  const baseWhere = {}
  if (status)   baseWhere.status   = status
  if (priority) baseWhere.priority = priority

  const [assigned, personal] = await Promise.all([
    // Tasks assigned to me BY someone else
    prisma.task.findMany({
      where: { ...baseWhere, assignedTo: userId, type: 'ASSIGNED' },
      include: {
        createdByUser: { select: userSelect },
        assignedToUser: { select: userSelect },
        _count: { select: { comments: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    // My personal tasks
    prisma.task.findMany({
      where: { ...baseWhere, createdBy: userId, type: 'PERSONAL' },
      include: {
        createdByUser: { select: userSelect },
        assignedToUser: { select: userSelect },
        _count: { select: { comments: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
  ])

  return { assigned, personal }
}

// ─── GET ALL TASKS (Admin) ────────────────────────────────────
// Super admin: sab dikhao
// Branch admin: sirf apni branch

export const getAllTasks = async (adminUser, query) => {
  const { status, priority, assignedTo, type, page = 1, limit = 50 } = query

  const where = {}
  if (status)     where.status   = status
  if (priority)   where.priority = priority
  if (assignedTo) where.assignedTo = assignedTo
  if (type)       where.type     = type

  // Branch scope
  if (adminUser.role === 'BRANCH_ADMIN') {
    where.branchId = adminUser.branchId
  }
  // Super admin: no branch filter (sab dikhega)

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        createdByUser: { select: userSelect },
        assignedToUser: { select: userSelect },
        _count: { select: { comments: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
    prisma.task.count({ where }),
  ])

  return { tasks, total, page: Number(page), limit: Number(limit) }
}

// ─── GET SINGLE TASK (with comments + activity) ───────────────

export const getTaskById = async (taskId, requestingUser) => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      createdByUser: { select: userSelect },
      assignedToUser: { select: userSelect },
      comments: {
        include: { user: { select: userSelect } },
        orderBy: { createdAt: 'asc' },
      },
      activities: {
        include: { user: { select: userSelect } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!task) throw { statusCode: 404, message: 'Task not found.' }

  // Access check: sirf wo dekh sake jo involved hai ya admin
  const isAdmin = requestingUser.role === 'SUPER_ADMIN' || requestingUser.role === 'BRANCH_ADMIN'
  const isInvolved = task.assignedTo === requestingUser.id || task.createdBy === requestingUser.id
  if (!isAdmin && !isInvolved) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  return task
}

// ─── UPDATE TASK ──────────────────────────────────────────────

export const updateTask = async (taskId, requestingUser, payload) => {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) throw { statusCode: 404, message: 'Task not found.' }

  const isAdmin = requestingUser.role === 'SUPER_ADMIN' || requestingUser.role === 'BRANCH_ADMIN'
  const isOwner = task.createdBy === requestingUser.id || task.assignedTo === requestingUser.id

  if (!isAdmin && !isOwner) {
    throw { statusCode: 403, message: 'You cannot edit this task.' }
  }

  // Non-admin: sirf status change kar sakta hai apne task ka
  const allowedFields = isAdmin
    ? ['title', 'description', 'priority', 'dueDate', 'status', 'assignedTo']
    : ['status']

  const updateData = {}
  const activities = []

  for (const field of allowedFields) {
    if (payload[field] === undefined) continue
    if (field === 'status' && payload.status !== task.status) {
      updateData.status = payload.status
      if (payload.status === 'DONE') updateData.completedAt = new Date()
      else updateData.completedAt = null
      activities.push(`Status changed to ${payload.status}`)
    } else if (field === 'priority' && payload.priority !== task.priority) {
      updateData.priority = payload.priority
      activities.push(`Priority changed to ${payload.priority}`)
    } else if (field === 'assignedTo' && payload.assignedTo !== task.assignedTo) {
      updateData.assignedTo = payload.assignedTo
      const newUser = await prisma.user.findUnique({ where: { id: payload.assignedTo }, select: { name: true } })
      activities.push(`Reassigned to ${newUser?.name ?? payload.assignedTo}`)
    } else if (field === 'dueDate') {
      updateData.dueDate = payload.dueDate ? new Date(payload.dueDate) : null
    } else if (field !== 'status' && field !== 'priority' && field !== 'assignedTo') {
      updateData[field] = payload[field]
    }
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
    include: {
      createdByUser: { select: userSelect },
      assignedToUser: { select: userSelect },
    },
  })

  // Bulk activity insert
  if (activities.length > 0) {
    await prisma.taskActivity.createMany({
      data: activities.map((action) => ({
        taskId, userId: requestingUser.id, action,
      })),
    })
  }

  return updated
}

// ─── DELETE TASK ──────────────────────────────────────────────

export const deleteTask = async (taskId, requestingUser) => {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) throw { statusCode: 404, message: 'Task not found.' }

  const isAdmin = requestingUser.role === 'SUPER_ADMIN' || requestingUser.role === 'BRANCH_ADMIN'
  const isCreator = task.createdBy === requestingUser.id

  if (!isAdmin && !isCreator) {
    throw { statusCode: 403, message: 'Only the task creator or an admin can delete this task.' }
  }

  await prisma.task.delete({ where: { id: taskId } })
  return { deleted: true }
}

// ─── ADD COMMENT ──────────────────────────────────────────────

export const addComment = async (taskId, userId, content) => {
  const task = await prisma.task.findUnique({ where: { id: taskId } })
  if (!task) throw { statusCode: 404, message: 'Task not found.' }

  const [comment] = await Promise.all([
    prisma.taskComment.create({
      data: { taskId, userId, content },
      include: { user: { select: userSelect } },
    }),
    prisma.taskActivity.create({
      data: { taskId, userId, action: 'Added a comment' },
    }),
  ])

  return comment
}

// ─── SCOREBOARD (branch-wise) ─────────────────────────────────

export const getScoreboard = async (branchId) => {
  // All users in branch
  const users = await prisma.user.findMany({
    where: { branchId, isActive: true },
    select: userSelect,
  })

  const scores = await Promise.all(
    users.map(async (u) => {
      const [completed, total, byPriority] = await Promise.all([
        prisma.task.count({
          where: { assignedTo: u.id, status: 'DONE' },
        }),
        prisma.task.count({
          where: { assignedTo: u.id },
        }),
        prisma.task.groupBy({
          by: ['priority'],
          where: { assignedTo: u.id, status: 'DONE' },
          _count: true,
        }),
      ])

      // Weighted score: HIGH=3, MEDIUM=2, LOW=1
      const weightMap = { HIGH: 3, MEDIUM: 2, LOW: 1 }
      const weightedScore = byPriority.reduce(
        (sum, g) => sum + g._count * (weightMap[g.priority] ?? 1),
        0,
      )

      return {
        user: u,
        completed,
        total,
        weightedScore,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      }
    }),
  )

  return scores.sort((a, b) => b.weightedScore - a.weightedScore)
}

// ─── STATS (for charts) ───────────────────────────────────────

export const getTaskStats = async (userId, requestingUser) => {
  const isAdmin = requestingUser.role === 'SUPER_ADMIN' || requestingUser.role === 'BRANCH_ADMIN'
  const targetId = isAdmin && userId ? userId : requestingUser.id

  // Last 7 days daily completion
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const recentDone = await prisma.task.findMany({
    where: {
      assignedTo: targetId,
      status: 'DONE',
      completedAt: { gte: sevenDaysAgo },
    },
    select: { completedAt: true },
  })

  // Group by date
  const dailyMap = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    dailyMap[key] = 0
  }
  recentDone.forEach((t) => {
    const key = t.completedAt.toISOString().slice(0, 10)
    if (dailyMap[key] !== undefined) dailyMap[key]++
  })

  const dailyCompletion = Object.entries(dailyMap).map(([date, count]) => ({ date, count }))

  // Status breakdown
  const statusBreakdown = await prisma.task.groupBy({
    by: ['status'],
    where: { assignedTo: targetId },
    _count: true,
  })

  // Priority breakdown
  const priorityBreakdown = await prisma.task.groupBy({
    by: ['priority'],
    where: { assignedTo: targetId },
    _count: true,
  })

  return { dailyCompletion, statusBreakdown, priorityBreakdown }
}