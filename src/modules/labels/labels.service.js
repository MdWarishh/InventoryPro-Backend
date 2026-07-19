import prisma from '../../config/db.js'

export const createLabel = async (data, user) => {
  const branchId = user.role === 'SUPER_ADMIN' ? (data.branchId || null) : user.branchId

  const existing = await prisma.label.findFirst({
    where: { name: data.name.trim(), branchId },
  })
  if (existing) throw { statusCode: 400, message: `Label "${data.name}" already exists.` }

  return prisma.label.create({
    data: { name: data.name.trim(), color: data.color || '#6366f1', branchId },
  })
}

export const getAllLabels = async (user, branchId) => {
  const where = { isActive: true }
  if (user.role === 'SUPER_ADMIN') {
    if (branchId) where.branchId = branchId
  } else {
    where.OR = [{ branchId: user.branchId }, { branchId: null }]
  }
  return prisma.label.findMany({ where, orderBy: { name: 'asc' } })
}

export const updateLabel = async (id, data, user) => {
  const label = await prisma.label.findUnique({ where: { id } })
  if (!label) throw { statusCode: 404, message: 'Label not found.' }
  if (user.role !== 'SUPER_ADMIN' && label.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  return prisma.label.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name.trim() }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
  })
}

export const deleteLabel = async (id, user) => {
  const label = await prisma.label.findUnique({ where: { id } })
  if (!label) throw { statusCode: 404, message: 'Label not found.' }
  if (user.role !== 'SUPER_ADMIN' && label.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  // invoices se label hata do, delete mat karo unhe
  await prisma.invoice.updateMany({ where: { labelId: id }, data: { labelId: null } })
  await prisma.label.delete({ where: { id } })
  return { message: 'Label deleted successfully.' }
}