import bcrypt from 'bcryptjs'
import prisma from '../../config/db.js'

const ALL_MODULES = [
  'DASHBOARD', 'USERS', 'STOCK', 'MEETINGS', 'REPORTS',
  'BRANCHES', 'NOTIFICATIONS', 'PRODUCTS', 'CATEGORIES',
  'DEALERS', 'SETTINGS', 'SALES', 'STOCK_TRANSFER'
]

// Helper: normalize incoming permissions array
// Expected format: [{ module: 'DASHBOARD', canView: true, canCreate: false, ... }]
const normalizePermissions = (permissions = []) => {
  return permissions
    .filter(p => ALL_MODULES.includes(p.module))
    .map(p => ({
      module: p.module,
      canView:   Boolean(p.canView),
      canCreate: Boolean(p.canCreate),
      canEdit:   Boolean(p.canEdit),
      canDelete: Boolean(p.canDelete),
    }))
}

export const getAllUsers = async (requestingUser, { page = 1, limit = 20, search, branchId, role }) => {
  const skip = (page - 1) * limit
  const where = { isActive: true }

  if (requestingUser.role !== 'SUPER_ADMIN') {
    where.branchId = requestingUser.branchId
  } else if (branchId) {
    where.branchId = branchId
  }

  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ]
  if (role) where.role = role

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where, skip, take: Number(limit),
      select: {
        id: true, name: true, email: true, role: true,
        isActive: true, branchId: true,
        branch: { select: { id: true, name: true } },
        createdAt: true,
        permissions: {
          select: { module: true, canView: true, canCreate: true, canEdit: true, canDelete: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ])

  return { users, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } }
}

export const createUser = async (data, requestingUser) => {
  const { name, email, password, role, branchId, permissions = [] } = data

  if (requestingUser.role === 'BRANCH_ADMIN') {
    if (role === 'SUPER_ADMIN') throw { statusCode: 403, message: 'Cannot create SUPER_ADMIN user.' }
    if (branchId && branchId !== requestingUser.branchId) throw { statusCode: 403, message: 'Cannot create user for another branch.' }
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw { statusCode: 409, message: 'Email already in use.' }

  const hashed = await bcrypt.hash(password, 12)
  const normalizedPerms = normalizePermissions(permissions)

  const user = await prisma.user.create({
    data: {
      name, email, password: hashed, role,
      branchId: branchId || null,
      permissions: {
        create: normalizedPerms
      }
    },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, isActive: true, createdAt: true,
      permissions: {
        select: { module: true, canView: true, canCreate: true, canEdit: true, canDelete: true }
      }
    },
  })
  return user
}

export const updateUser = async (id, data, requestingUser) => {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw { statusCode: 404, message: 'User not found.' }

  if (requestingUser.role === 'BRANCH_ADMIN' && user.branchId !== requestingUser.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  const { name, role, branchId, isActive, permissions } = data

  // Update basic user fields
  const updated = await prisma.user.update({
    where: { id },
    data: { name, role, branchId, isActive },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, isActive: true,
    },
  })

  // If permissions provided, do a full replace (delete old, insert new)
  if (Array.isArray(permissions)) {
    const normalizedPerms = normalizePermissions(permissions)

    await prisma.$transaction([
      prisma.permission.deleteMany({ where: { userId: id } }),
      prisma.permission.createMany({
        data: normalizedPerms.map(p => ({ ...p, userId: id }))
      })
    ])
  }

  // Return updated user with fresh permissions
  const result = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, isActive: true,
      permissions: {
        select: { module: true, canView: true, canCreate: true, canEdit: true, canDelete: true }
      }
    }
  })
  return result
}

export const deleteUser = async (id, requestingUser) => {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw { statusCode: 404, message: 'User not found.' }
  if (user.id === requestingUser.id) throw { statusCode: 400, message: 'Cannot delete your own account.' }

  await prisma.user.update({ where: { id }, data: { isActive: false } })
}

export const resetUserPassword = async (id, newPassword) => {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw { statusCode: 404, message: 'User not found.' }
  const hashed = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({ where: { id }, data: { password: hashed } })
}

// Utility: get a single user's permissions (used by auth middleware)
export const getUserPermissions = async (userId) => {
  return prisma.permission.findMany({
    where: { userId },
    select: { module: true, canView: true, canCreate: true, canEdit: true, canDelete: true }
  })
}


export const getProfile = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, isActive: true, whatsappNumber: true,
      branch: { select: { id: true, name: true } },
    }
  })
  if (!user) throw { statusCode: 404, message: 'User not found.' }
  return user
}

export const updateProfile = async (id, data) => {
  const { whatsappNumber } = data
  return prisma.user.update({
    where: { id },
    data: { whatsappNumber: whatsappNumber ?? undefined },
    select: {
      id: true, name: true, email: true, role: true,
      branchId: true, whatsappNumber: true,
    }
  })
}