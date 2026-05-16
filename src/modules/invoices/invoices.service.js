import prisma from '../../config/db.js'
import { generateInvoiceNumber, resetInvoiceCounter } from '../../utils/generateInvoiceNo.js'

export const createInvoice = async (data, user) => {
  const {
    branchId, customerName, customerPhone, customerEmail,
    customerAddress, customerGST, items, discount = 0, notes, terms, date,
    paymentMode = 'CASH',
    dealerId = null,          // NEW: optional — dealer invoice flow
    isDealerInvoice = false,  // NEW: flag to skip productStock check
  } = data

  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied to this branch.' }
  }

  // ── Validate dealer if provided ───────────────────────────────────────────
  if (dealerId) {
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
    if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
  }

  const invoiceNumber = await generateInvoiceNumber(branchId)

  let subtotal = 0
  let gstAmount = 0
  const processedItems = []

  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } })
    if (!product) throw { statusCode: 404, message: `Product not found: ${item.productId}` }

    const itemTotal = item.sellingPrice * item.quantity
    const itemGST = itemTotal * (product.gstRate / 100)
    subtotal += itemTotal
    gstAmount += itemGST
    processedItems.push({ ...item, product, gstRate: product.gstRate })
  }

  const totalAmount = subtotal + gstAmount - Number(discount)

  const invoice = await prisma.$transaction(async (tx) => {
    // ── Create Invoice ────────────────────────────────────────────────────
    const inv = await tx.invoice.create({
      data: {
        invoiceNumber, branchId,
        customerName, customerPhone, customerEmail,
        customerAddress, customerGST,
        subtotal, gstAmount,
        discount: Number(discount),
        totalAmount,
        notes, terms,
        paymentMode,
        date: date ? new Date(date) : new Date(),
        createdBy: user.id,
        ...(dealerId && { dealerId }),  // link dealer if provided
      },
    })

    for (const item of processedItems) {
      // ── DEALER INVOICE PATH ───────────────────────────────────────────
      // No productStock check — stock was already deducted when given to dealer
      if (dealerId) {
        // Validate that serial numbers belong to this dealer and are UNBILLED
        if (item.serialNumberIds?.length) {
          const serials = await tx.serialNumber.findMany({
            where: {
              id: { in: item.serialNumberIds },
              status: 'TRANSFERRED',
              OR: [
                { dealerBillingStatus: 'UNBILLED' },
                { dealerBillingStatus: null },
              ],
            },
          })

          if (serials.length !== item.serialNumberIds.length) {
            throw {
              statusCode: 400,
              message: `Some serial numbers for "${item.product.name}" are already billed or not available.`,
            }
          }

          // Verify all serials belong to this dealer via stockIn
          const stockInIds = await tx.stockIn.findMany({
            where: { dealerId },
            select: { id: true },
          })
          const validStockInIds = new Set(stockInIds.map(s => s.id))
          const invalidSerial = serials.find(s => !validStockInIds.has(s.stockInId))
          if (invalidSerial) {
            throw {
              statusCode: 400,
              message: `Serial number ${invalidSerial.serialNumber} does not belong to this dealer.`,
            }
          }

          // Mark serials as SOLD + BILLED
          // SOLD: getDealerSerials (TRANSFERRED filter) mein ab nahi aayenge
          // BILLED: dealer invoice track ke liye
          await tx.serialNumber.updateMany({
            where: { id: { in: item.serialNumberIds } },
            data: {
              status: 'SOLD',
              dealerBillingStatus: 'BILLED',
              dealerInvoiceId: inv.id,
            },
          })
        }

        // Create StockOut record (for invoice relation — no stock deduction)
        await tx.stockOut.create({
          data: {
            productId: item.productId,
            branchId,
            quantity: Number(item.quantity),
            sellingPrice: Number(item.sellingPrice),
            customerName, customerPhone, customerEmail, customerAddress,
            invoiceId: inv.id,
            notes,
            date: date ? new Date(date) : new Date(),
            createdBy: user.id,
            // NOTE: productStock NOT decremented — already done at StockIn time
          },
        })

        // DO NOT decrement productStock — it was already deducted when stock was given to dealer

      } else {
        // ── NORMAL INVOICE PATH (existing logic, untouched) ───────────────
        const stockOutData = {
          productId: item.productId,
          branchId,
          quantity: Number(item.quantity),
          sellingPrice: Number(item.sellingPrice),
          customerName, customerPhone, customerEmail, customerAddress,
          invoiceId: inv.id,
          notes,
          date: date ? new Date(date) : new Date(),
          createdBy: user.id,
        }

        const currentStock = await tx.productStock.findUnique({
          where: { productId_branchId: { productId: item.productId, branchId } },
        })
        if (!currentStock || currentStock.currentStock < item.quantity) {
          throw { statusCode: 400, message: `Insufficient stock for: ${item.product.name}` }
        }

        const stockOut = await tx.stockOut.create({ data: stockOutData })

        if (item.serialNumberIds?.length) {
          await tx.serialNumber.updateMany({
            where: { id: { in: item.serialNumberIds } },
            data: { status: 'SOLD', stockOutId: stockOut.id },
          })
        }

        await tx.productStock.update({
          where: { productId_branchId: { productId: item.productId, branchId } },
          data: { currentStock: { decrement: Number(item.quantity) } },
        })
      }
    }

    return inv
  })

  return getInvoiceById(invoice.id, user)
}

export const getInvoiceById = async (id, user) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: {
        include: {
          product: { include: { category: true } },
          serialNumbers: { select: { id: true, serialNumber: true } },
        },
      },
      dealer: {
        select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true },
      },
    },
  })
  if (!invoice) throw { statusCode: 404, message: 'Invoice not found.' }
  if (user.role !== 'SUPER_ADMIN' && invoice.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  const branch = await prisma.branch.findUnique({
    where: { id: invoice.branchId },
    include: { settings: true },
  })

  return { ...invoice, branch }
}

export const getAllInvoices = async (user, { page = 1, limit = 20, branchId, startDate, endDate, search, dealerId } = {}) => {
  const skip = (page - 1) * limit
  const where = {}

  if (user.role !== 'SUPER_ADMIN') where.branchId = user.branchId
  else if (branchId) where.branchId = branchId

  // NEW: filter by dealer
  if (dealerId) where.dealerId = dealerId

  if (search) where.OR = [
    { invoiceNumber: { contains: search, mode: 'insensitive' } },
    { customerName: { contains: search, mode: 'insensitive' } },
    { customerPhone: { contains: search } },
  ]
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate)
    if (endDate) where.date.lte = new Date(endDate)
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where, skip, take: Number(limit),
      include: {
        stockOuts: { select: { id: true, quantity: true, product: { select: { name: true } } } },
        dealer: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.invoice.count({ where }),
  ])

  return { invoices, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } }
}

export const resetCounter = async (branchId, user) => {
  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  return resetInvoiceCounter(branchId)
}