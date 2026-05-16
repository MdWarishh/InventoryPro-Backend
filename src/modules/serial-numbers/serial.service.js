import prisma from '../../config/db.js'

export const getSerialsByProduct = async (productId, branchId, status, user) => {
  const where = { productId }
  if (branchId) where.branchId = branchId
  else if (user.role !== 'SUPER_ADMIN') where.branchId = user.branchId
  if (status) where.status = status

  return prisma.serialNumber.findMany({
    where,
    include: {
      branch: { select: { id: true, name: true } },
      stockIn: { select: { id: true, date: true, dealer: { select: { name: true } } } },
      stockOut: { select: { id: true, date: true, invoice: { select: { invoiceNumber: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export const getAvailableSerials = async (productId, branchId, user) => {
  const effectiveBranchId = user.role !== 'SUPER_ADMIN' ? user.branchId : branchId
  return prisma.serialNumber.findMany({
    where: { productId, branchId: effectiveBranchId, status: 'AVAILABLE' },
    orderBy: { serialNumber: 'asc' },
  })
}

export const markSerialDamaged = async (id, user) => {
  const serial = await prisma.serialNumber.findUnique({ where: { id } })
  if (!serial) throw { statusCode: 404, message: 'Serial number not found.' }
  if (user.role !== 'SUPER_ADMIN' && serial.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  if (serial.status !== 'AVAILABLE') {
    throw { statusCode: 400, message: `Cannot mark as damaged. Current status: ${serial.status}` }
  }

  await prisma.$transaction([
    prisma.serialNumber.update({ where: { id }, data: { status: 'DAMAGED' } }),
    prisma.productStock.update({
      where: { productId_branchId: { productId: serial.productId, branchId: serial.branchId } },
      data: { currentStock: { decrement: 1 } },
    }),
  ])
}

export const searchSerials = async (query, user) => {
  const where = {
    serialNumber: { contains: query, mode: 'insensitive' },
    ...(user.role !== 'SUPER_ADMIN' && { branchId: user.branchId }),
  }
  return prisma.serialNumber.findMany({
    where,
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
    },
    take: 30,
  })
}
export const getSerialsByDealer = async (dealerId, productId, branchId) => {
  // Dealer ko jo stockIns diye gaye unke IDs nikalo
  const stockInWhere = { dealerId }
  if (productId) stockInWhere.productId = productId
  if (branchId) stockInWhere.branchId = branchId

  const stockIns = await prisma.stockIn.findMany({
    where: stockInWhere,
    select: { id: true },
  })
  const stockInIds = stockIns.map(s => s.id)
  if (!stockInIds.length) return []

  // Sirf TRANSFERRED serials jo abhi dealer ke paas hain (sold nahi hue)
  const serialWhere = { stockInId: { in: stockInIds }, status: 'TRANSFERRED' }
  if (productId) serialWhere.productId = productId
  if (branchId) serialWhere.branchId = branchId

  return prisma.serialNumber.findMany({
    where: serialWhere,
    select: { id: true, serialNumber: true, status: true },
    orderBy: { serialNumber: 'asc' },
  })
}