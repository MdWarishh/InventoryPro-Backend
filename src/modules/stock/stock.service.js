import prisma from '../../config/db.js'
import { sendLowStockNotification } from '../notifications/notifications.service.js'

// ─── helper: branch access check ─────────────────────────────────────────────
const checkBranchAccess = (user, branchId) => {
  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied to this branch.' }
  }
}

// ─── STOCK IN ─────────────────────────────────────────────────────────────────

export const stockIn = async (data, user) => {
  const { productId, branchId, quantity, purchasePrice, dealerId, sourceNote, referenceNo, date, serialNumbers } = data

  checkBranchAccess(user, branchId)

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


    await tx.product.update({
  where: { id: productId },
  data: { purchasePrice: Number(purchasePrice) },
})

    return stockInRecord
  })

  return prisma.stockIn.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true, brand: true } },
      branch: { select: { id: true, name: true } },
      dealer: { select: { id: true, name: true } },
      serialNumbers: true,
    },
  })
}

// ─── STOCK IN: UPDATE ─────────────────────────────────────────────────────────

export const updateStockIn = async (id, data, user) => {
  const { quantity, purchasePrice, dealerId, sourceNote, referenceNo, date, serialNumbers } = data

  const existing = await prisma.stockIn.findUnique({
    where: { id },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-in record not found.' }

  checkBranchAccess(user, existing.branchId)

  // Check if any serial numbers from this record are already SOLD — block edit if so
  if (existing.serialNumbers?.length) {
    const soldSerials = existing.serialNumbers.filter(s => s.status === 'SOLD')
    if (soldSerials.length > 0) {
      throw {
        statusCode: 400,
        message: `Cannot edit: ${soldSerials.length} serial number(s) from this record have already been sold.`,
      }
    }
  }

  const product = await prisma.product.findUnique({ where: { id: existing.productId } })

  const newQty = Number(quantity)
  const oldQty = existing.quantity
  const qtyDiff = newQty - oldQty // positive = stock increase, negative = stock decrease

  // Validate serial numbers if product requires them
  if (product.hasSerialNumbers) {
    if (!serialNumbers || serialNumbers.length === 0) {
      throw { statusCode: 400, message: 'Serial numbers are required for this product.' }
    }
    if (serialNumbers.length !== newQty) {
      throw { statusCode: 400, message: `Serial numbers count (${serialNumbers.length}) must match quantity (${newQty}).` }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update productStock by applying the diff
    await tx.productStock.update({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
      data: { currentStock: { increment: qtyDiff } },
    })

    // Handle serial numbers: delete old AVAILABLE ones, create new ones
    if (product.hasSerialNumbers && serialNumbers?.length) {
      await tx.serialNumber.deleteMany({
        where: { stockInId: id, status: 'AVAILABLE' },
      })

      // Check for duplicates excluding the ones we just deleted
      const duplicates = await tx.serialNumber.findMany({
        where: { serialNumber: { in: serialNumbers }, productId: existing.productId },
      })
      if (duplicates.length > 0) {
        const dups = duplicates.map(s => s.serialNumber).join(', ')
        throw { statusCode: 409, message: `Duplicate serial numbers: ${dups}` }
      }

      await tx.serialNumber.createMany({
        data: serialNumbers.map(sn => ({
          serialNumber: sn,
          productId: existing.productId,
          branchId: existing.branchId,
          status: 'AVAILABLE',
          stockInId: id,
        })),
      })
    }

    await tx.product.update({
  where: { id: existing.productId },
  data: { purchasePrice: Number(purchasePrice) },
})

    return tx.stockIn.update({
      where: { id },
      data: {
        quantity: newQty,
        purchasePrice: Number(purchasePrice),
        dealerId: dealerId || null,
        sourceNote, referenceNo,
        date: date ? new Date(date) : existing.date,
      },
    })
  })

  return prisma.stockIn.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true, brand: true } },
      branch: { select: { id: true, name: true } },
      dealer: { select: { id: true, name: true } },
      serialNumbers: true,
    },
  })
}

// ─── STOCK IN: DELETE ─────────────────────────────────────────────────────────

export const deleteStockIn = async (id, user) => {
  const existing = await prisma.stockIn.findUnique({
    where: { id },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-in record not found.' }

  checkBranchAccess(user, existing.branchId)

  const availableSerials = existing.serialNumbers.filter(s => s.status === 'AVAILABLE')
  // Sold/Transferred serials already left the stock ledger at sale time,
  // so we only decrement currentStock for units that are still sitting unsold.
  const decrementQty = existing.serialNumbers.length > 0
    ? availableSerials.length
    : existing.quantity

  const productStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
  })
  if (productStock && productStock.currentStock < decrementQty) {
    throw {
      statusCode: 400,
      message: `Cannot delete: current stock (${productStock.currentStock}) is less than unsold quantity (${decrementQty}).`,
    }
  }

  await prisma.$transaction(async (tx) => {
    // Delete ALL serial numbers tied to this stockIn, regardless of status
    await tx.serialNumber.deleteMany({ where: { stockInId: id } })

    // Reverse stock only for units that were still unsold
    if (decrementQty > 0) {
      await tx.productStock.update({
        where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
        data: { currentStock: { decrement: decrementQty } },
      })
    }

    await tx.stockIn.delete({ where: { id } })
  })

  return { message: 'Stock-in record and all its serial numbers deleted successfully.' }
}

// ─── STOCK OUT ────────────────────────────────────────────────────────────────

export const stockOut = async (data, user) => {
  const { productId, branchId, quantity, sellingPrice, customerName, customerPhone, customerEmail, customerAddress, serialNumberIds, invoiceId, notes, date } = data

  checkBranchAccess(user, branchId)

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
      product: { select: { id: true, name: true, sku: true, brand: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: true,
      invoice: true,
    },
  })
}

// ─── STOCK OUT: UPDATE ────────────────────────────────────────────────────────

export const updateStockOut = async (id, data, user) => {
  const { quantity, sellingPrice, customerName, customerPhone, customerEmail, customerAddress, serialNumberIds, invoiceId, notes, date } = data

  const existing = await prisma.stockOut.findUnique({
    where: { id },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-out record not found.' }

  checkBranchAccess(user, existing.branchId)

  const product = await prisma.product.findUnique({ where: { id: existing.productId } })
  const newQty = Number(quantity)
  const oldQty = existing.quantity
  const qtyDiff = newQty - oldQty // positive = more sold, negative = less sold

  if (product.hasSerialNumbers) {
    if (!serialNumberIds?.length) throw { statusCode: 400, message: 'Serial numbers are required.' }
    if (serialNumberIds.length !== newQty) {
      throw { statusCode: 400, message: `Select exactly ${newQty} serial number(s).` }
    }
  }

  // Check enough stock available for the additional quantity (if increasing)
  if (qtyDiff > 0) {
    const productStock = await prisma.productStock.findUnique({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
    })
    if (!productStock || productStock.currentStock < qtyDiff) {
      throw {
        statusCode: 400,
        message: `Insufficient stock to increase quantity. Available: ${productStock?.currentStock || 0}`,
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Reverse old serial numbers → AVAILABLE
    if (existing.serialNumbers?.length) {
      await tx.serialNumber.updateMany({
        where: { stockOutId: id },
        data: { status: 'AVAILABLE', stockOutId: null },
      })
    }

    // Apply new serial numbers if product requires
    if (product.hasSerialNumbers && serialNumberIds?.length) {
      const serials = await tx.serialNumber.findMany({
        where: { id: { in: serialNumberIds }, status: 'AVAILABLE', branchId: existing.branchId },
      })
      if (serials.length !== serialNumberIds.length) {
        throw { statusCode: 400, message: 'Some selected serial numbers are not available.' }
      }
      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: { status: 'SOLD', stockOutId: id },
      })
    }

    // Update productStock: reverse old qty, apply new qty → net = -qtyDiff
    await tx.productStock.update({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
      data: { currentStock: { increment: oldQty - newQty } },
    })

    return tx.stockOut.update({
      where: { id },
      data: {
        quantity: newQty,
        sellingPrice: Number(sellingPrice),
        customerName, customerPhone, customerEmail, customerAddress,
        invoiceId: invoiceId || null,
        notes,
        date: date ? new Date(date) : existing.date,
      },
    })
  })

  // Low stock check after edit
  const updatedStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
  })
  if (updatedStock && updatedStock.currentStock <= product.minStockAlert) {
    const branch = await prisma.branch.findUnique({ where: { id: existing.branchId }, select: { name: true } })
    sendLowStockNotification(product, branch?.name, updatedStock.currentStock, user.id).catch(console.error)
  }

  return prisma.stockOut.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true, brand: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: true,
      invoice: true,
    },
  })
}

// ─── STOCK OUT: DELETE ────────────────────────────────────────────────────────

export const deleteStockOut = async (id, user) => {
  const existing = await prisma.stockOut.findUnique({
    where: { id },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-out record not found.' }

  checkBranchAccess(user, existing.branchId)

  await prisma.$transaction(async (tx) => {
    // Reverse serial numbers back to AVAILABLE
    if (existing.serialNumbers?.length) {
      await tx.serialNumber.updateMany({
        where: { stockOutId: id },
        data: { status: 'AVAILABLE', stockOutId: null },
      })
    }

    // Add stock back
    await tx.productStock.update({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
      data: { currentStock: { increment: existing.quantity } },
    })

    await tx.stockOut.delete({ where: { id } })
  })

  return { message: 'Stock-out record deleted successfully.' }
}

// ─── GET HISTORY ──────────────────────────────────────────────────────────────

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
          product: { select: { id: true, name: true, sku: true, brand: true } },
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
        product: { select: { id: true, name: true, sku: true, brand: true } },
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

// ─── GET CURRENT STOCK ────────────────────────────────────────────────────────

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

// ─── GET PRODUCTS WITH STOCK > 0 (for invoice/dealer dropdowns) ──────────────

export const getProductsWithStock = async (user, { branchId, categoryId, search } = {}) => {
  const branchFilter = user.role === 'SUPER_ADMIN'
    ? (branchId ? { branchId } : {})
    : { branchId: user.branchId }

  const stocks = await prisma.productStock.findMany({
    where: {
      ...branchFilter,
      currentStock: { gt: 0 },          // ← sirf wahi products jinka stock > 0 hai
      product: {
        isActive: true,
        ...(categoryId && { categoryId }),
        ...(search && {
          name: { contains: search, mode: 'insensitive' },
        }),
      },
    },
    select: {
      currentStock: true,
      branchId: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          brand: true,
          sellingPrice: true,
          hasSerialNumbers: true,
          minStockAlert: true,
          category: { select: { id: true, name: true, color: true } },
        },
      },
    },
    orderBy: { product: { name: 'asc' } },
  })

  // Response format: product fields + currentStock merged
  return stocks
    .filter(s => s.product)
    .map(s => ({
      ...s.product,
      currentStock: s.currentStock,
      branchId: s.branchId,
    }))
}

// ─── TRANSFER STOCK ───────────────────────────────────────────────────────────

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

// ─── STOCK IN: REMOVE ONLY UNSOLD SERIALS (PARTIAL DELETE) ───────────────────

export const removeUnsoldFromStockIn = async (id, user) => {
  const existing = await prisma.stockIn.findUnique({
    where: { id },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-in record not found.' }

  checkBranchAccess(user, existing.branchId)

  const soldSerials = existing.serialNumbers.filter(s => s.status === 'SOLD')
  const availableSerials = existing.serialNumbers.filter(s => s.status === 'AVAILABLE')

  if (availableSerials.length === 0) {
    throw { statusCode: 400, message: 'No unsold serial numbers to remove.' }
  }

  // Check current stock has enough to reduce (safety)
  const productStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
  })
  if (!productStock || productStock.currentStock < availableSerials.length) {
    throw {
      statusCode: 400,
      message: `Cannot remove: current stock (${productStock?.currentStock || 0}) is less than unsold quantity (${availableSerials.length}).`,
    }
  }

  await prisma.$transaction(async (tx) => {
    // Delete only the AVAILABLE serial numbers tied to this stockIn
    await tx.serialNumber.deleteMany({
      where: { stockInId: id, status: 'AVAILABLE' },
    })

    // Decrement stock by however many were removed
    await tx.productStock.update({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
      data: { currentStock: { decrement: availableSerials.length } },
    })

    // Shrink the stockIn record's quantity to match remaining (sold) count
    await tx.stockIn.update({
      where: { id },
      data: { quantity: soldSerials.length },
    })
  })

  return prisma.stockIn.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true, sku: true, brand: true } },
      branch: { select: { id: true, name: true } },
      dealer: { select: { id: true, name: true } },
      serialNumbers: true,
    },
  })
}