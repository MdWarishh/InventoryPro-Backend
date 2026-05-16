import prisma from '../../config/db.js'

export const getAllBranches = async (user) => {
  const where = user.role === 'SUPER_ADMIN' ? {} : { id: user.branchId }
  return prisma.branch.findMany({
    where,
    include: {
      _count: { select: { users: true, stockIns: true, stockOuts: true } },
      settings: { select: { companyName: true, logo: true, primaryColor: true } },
    },
    orderBy: [{ isMainBranch: 'desc' }, { createdAt: 'asc' }],
  })
}

export const getBranchById = async (id, user) => {
  if (user.role !== 'SUPER_ADMIN' && user.branchId !== id) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  const branch = await prisma.branch.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      settings: true,
      _count: { select: { stockIns: true, stockOuts: true, productStocks: true } },
    },
  })
  if (!branch) throw { statusCode: 404, message: 'Branch not found.' }
  return branch
}

export const createBranch = async (data) => {
  // Validate code uniqueness
  if (data.code) {
    const existing = await prisma.branch.findFirst({ where: { code: data.code.toUpperCase() } })
    if (existing) throw { statusCode: 409, message: 'Branch code already in use.' }
  }

  const branch = await prisma.branch.create({
    data: {
      name: data.name,
      code: data.code ? data.code.toUpperCase() : null,
      address: data.address,
      phone: data.phone,
      email: data.email,
      isMainBranch: false,
    },
  })

  await prisma.settings.create({
    data: { branchId: branch.id, companyName: data.name },
  })

  return branch
}

export const updateBranch = async (id, data) => {
  const branch = await prisma.branch.findUnique({ where: { id } })
  if (!branch) throw { statusCode: 404, message: 'Branch not found.' }

  // Check code uniqueness (exclude self)
  if (data.code) {
    const existing = await prisma.branch.findFirst({
      where: { code: data.code.toUpperCase(), NOT: { id } },
    })
    if (existing) throw { statusCode: 409, message: 'Branch code already in use.' }
  }

  return prisma.branch.update({
    where: { id },
    data: {
      name: data.name,
      code: data.code ? data.code.toUpperCase() : undefined,
      address: data.address,
      phone: data.phone,
      email: data.email,
      isActive: data.isActive,
    },
  })
}

export const deleteBranch = async (id) => {
  const branch = await prisma.branch.findUnique({ where: { id } })
  if (!branch) throw { statusCode: 404, message: 'Branch not found.' }
  if (branch.isMainBranch) throw { statusCode: 400, message: 'Cannot delete the main branch.' }

  await prisma.branch.update({ where: { id }, data: { isActive: false } })
}

export const getBranchStats = async (id) => {
  const [stockValue, totalStockIn, totalStockOut] = await Promise.all([
    prisma.productStock.aggregate({ where: { branchId: id }, _sum: { currentStock: true } }),
    prisma.stockIn.count({ where: { branchId: id } }),
    prisma.stockOut.count({ where: { branchId: id } }),
  ])

  return {
    totalStock: stockValue._sum.currentStock || 0,
    totalStockIn,
    totalStockOut,
  }
}