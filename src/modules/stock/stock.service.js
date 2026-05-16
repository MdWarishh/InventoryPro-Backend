import prisma from '../../config/db.js'
import { sendLowStockNotification } from '../notifications/notifications.service.js'

export const stockIn = async (data, user) => {
  const { productId, branchId, quantity, purchasePrice, dealerId, sourceNote, referenceNo, date, serialNumbers } = data

  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied to this branch.' }
  }

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }

  if (product.hasSerialNumbers && (!serialNumbers || serialNumbers.length === 0)) {
    throw { statusCode: 400, message: 'Serial numbers are required for this product.' }
  }
  if (product.hasSerialNumbers && serialNumbers.length !== Number(quantity)) {
    throw { statusCode: 400, message: `Number of serial numbers (${serialNumbers.length}) must match quantity (${quantity}).` }
  }

  const result = await prisma.$transaction(async (tx) => {
    const stockInRecord = await tx.stockIn.create({
      data: {
        productId, branchId,
        quantity: Number(quantity),
        purchasePrice: Number(purchasePrice),
        dealerId: dealerId || null,
        sourceNote, referenceNo,
        date: date ? new Date(date) : new Date(),
        createdBy: user.id,
      },
    })

    if (serialNumbers?.length) {
      const existing = await tx.serialNumber.findMany({
        where: { serialNumber: { in: serialNumbers }, productId },
      })
      if (existing.length > 0) {
        const dups = existing.map(s => s.serialNumber).join(', ')
        throw { statusCode: 409, message: `Duplicate serial numbers: ${dups}` }
      }

      await tx.serialNumber.createMany({
        data: serialNumbers.map(sn => ({
          serialNumber: sn,
          productId, branchId,
          status: 'AVAILABLE',
          stockInId: stockInRecord.id,
        })),
      })
    }

    await tx.productStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      update: { currentStock: { increment: Number(quantity) } },
      create: { productId, branchId, currentStock: Number(quantity) },
    })

    return stockInRecord
  })

  return prisma.stockIn.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      dealer: { select: { id: true, name: true } },
      serialNumbers: true,
    },
  })
}

export const stockOut = async (data, user) => {
  const { productId, branchId, quantity, sellingPrice, customerName, customerPhone, customerEmail, customerAddress, serialNumberIds, invoiceId, notes, date } = data

  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied to this branch.' }
  }

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }

  const currentStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId, branchId } },
  })

  if (!currentStock || currentStock.currentStock < Number(quantity)) {
    throw { statusCode: 400, message: `Insufficient stock. Available: ${currentStock?.currentStock || 0}` }
  }

  if (product.hasSerialNumbers) {
    if (!serialNumberIds?.length) throw { statusCode: 400, message: 'Serial numbers must be selected for this product.' }
    if (serialNumberIds.length !== Number(quantity)) {
      throw { statusCode: 400, message: `Select exactly ${quantity} serial number(s).` }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const stockOutRecord = await tx.stockOut.create({
      data: {
        productId, branchId,
        quantity: Number(quantity),
        sellingPrice: Number(sellingPrice),
        customerName, customerPhone, customerEmail, customerAddress,
        invoiceId: invoiceId || null,
        notes,
        date: date ? new Date(date) : new Date(),
        createdBy: user.id,
      },
    })

    if (serialNumberIds?.length) {
      const serials = await tx.serialNumber.findMany({
        where: { id: { in: serialNumberIds }, status: 'AVAILABLE', branchId },
      })
      if (serials.length !== serialNumberIds.length) {
        throw { statusCode: 400, message: 'Some serial numbers are not available.' }
      }

      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: { status: 'SOLD', stockOutId: stockOutRecord.id },
      })
    }

    await tx.productStock.update({
      where: { productId_branchId: { productId, branchId } },
      data: { currentStock: { decrement: Number(quantity) } },
    })

    return stockOutRecord
  })

  const updatedStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId, branchId } },
  })
  if (updatedStock && updatedStock.currentStock <= product.minStockAlert) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } })
    sendLowStockNotification(product, branch?.name, updatedStock.currentStock, user.id).catch(console.error)
  }

  return prisma.stockOut.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: true,
      invoice: true,
    },
  })
}

export const getStockHistory = async (user, { type, page = 1, limit = 20, branchId, productId, startDate, endDate } = {}) => {
  const skip = (page - 1) * limit
  const branchFilter = user.role === 'SUPER_ADMIN' ? (branchId ? { branchId } : {}) : { branchId: user.branchId }
  const dateFilter = {}
  if (startDate || endDate) {
    dateFilter.date = {}
    if (startDate) dateFilter.date.gte = new Date(startDate)
    if (endDate) dateFilter.date.lte = new Date(endDate)
  }
  const where = { ...branchFilter, ...(productId && { productId }), ...dateFilter }

  if (type === 'in') {
    const [items, total] = await Promise.all([
      prisma.stockIn.findMany({
        where, skip, take: Number(limit),
        include: {
          product: { select: { id: true, name: true, sku: true } },
          branch: { select: { id: true, name: true } },
          dealer: { select: { id: true, name: true } },
          serialNumbers: { select: { id: true, serialNumber: true, status: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.stockIn.count({ where }),
    ])
    return { items, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } }
  }

  const [items, total] = await Promise.all([
    prisma.stockOut.findMany({
      where, skip, take: Number(limit),
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
        serialNumbers: { select: { id: true, serialNumber: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.stockOut.count({ where }),
  ])
  return { items, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } }
}

export const getCurrentStock = async (user, { branchId, categoryId, lowStock } = {}) => {
  const branchFilter = user.role === 'SUPER_ADMIN' ? (branchId ? { branchId } : {}) : { branchId: user.branchId }

  const stocks = await prisma.productStock.findMany({
     where: {
    ...branchFilter,

    product: {
      isActive: true,
      ...(categoryId && { categoryId }),
    },
  },
    include: {
      product: {
        // where: { isActive: true, ...(categoryId && { categoryId }) },
        include: { category: { select: { id: true, name: true, color: true } } },
      },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { product: { name: 'asc' } },
  })

  const filtered = stocks.filter(s => s.product)
  return lowStock === 'true'
    ? filtered.filter(s => s.currentStock <= s.product.minStockAlert)
    : filtered
}

export const transferStock = async (data, user) => {
  const { fromBranchId, toBranchId, items, notes } = data

  if (user.role !== 'SUPER_ADMIN') throw { statusCode: 403, message: 'Only SUPER_ADMIN can transfer stock.' }

  const transfer = await prisma.$transaction(async (tx) => {
    const transferRecord = await tx.stockTransfer.create({
      data: { fromBranchId, toBranchId, notes, createdBy: user.id, status: 'COMPLETED' },
    })

    for (const item of items) {
      const fromStock = await tx.productStock.findUnique({
        where: { productId_branchId: { productId: item.productId, branchId: fromBranchId } },
      })
      if (!fromStock || fromStock.currentStock < item.quantity) {
        throw { statusCode: 400, message: `Insufficient stock for product ID: ${item.productId}` }
      }

      await tx.productStock.update({
        where: { productId_branchId: { productId: item.productId, branchId: fromBranchId } },
        data: { currentStock: { decrement: item.quantity } },
      })
      await tx.productStock.upsert({
        where: { productId_branchId: { productId: item.productId, branchId: toBranchId } },
        update: { currentStock: { increment: item.quantity } },
        create: { productId: item.productId, branchId: toBranchId, currentStock: item.quantity },
      })
      await tx.stockTransferItem.create({
        data: { transferId: transferRecord.id, productId: item.productId, quantity: item.quantity },
      })
    }

    return transferRecord
  })

  return transfer
}