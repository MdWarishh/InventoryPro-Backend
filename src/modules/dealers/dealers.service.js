import prisma from '../../config/db.js'

// ─── DEALERS CRUD ────────────────────────────────────────────────────────────

export const getAllDealers = async ({ page = 1, limit = 20, search } = {}) => {
  const skip = (page - 1) * limit
  const where = { isActive: true }

  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { phone: { contains: search } },
    { email: { contains: search, mode: 'insensitive' } },
    { gstNumber: { contains: search } },
    { city: { contains: search, mode: 'insensitive' } },
  ]

  const [dealers, total] = await Promise.all([
    prisma.dealer.findMany({
      where, skip, take: Number(limit),
      include: { _count: { select: { stockIns: true, stockOuts: true, invoices: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.dealer.count({ where }),
  ])

  // _count.invoices = DealerInvoice (old model) — Invoice (main model) se alag count karo
  const dealerIds = dealers.map(d => d.id)
  const mainInvoiceCounts = await prisma.invoice.groupBy({
    by: ['dealerId'],
    where: { dealerId: { in: dealerIds } },
    _count: { id: true },
  })
  const mainInvoiceMap = Object.fromEntries(mainInvoiceCounts.map(r => [r.dealerId, r._count.id]))

  const dealersWithCount = dealers.map(d => ({
    ...d,
    _count: {
      ...d._count,
      invoices: mainInvoiceMap[d.id] ?? 0,  // Invoice model ka count
    },
  }))

  return {
    dealers: dealersWithCount,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
  }
}

export const getDealerById = async (id) => {
  const [dealer, mainInvoiceCount] = await Promise.all([
    prisma.dealer.findUnique({
      where: { id },
      include: {
        stockIns: {
          take: 5, orderBy: { createdAt: 'desc' },
          include: {
            product: { select: { id: true, name: true, sku: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        stockOuts: {
          take: 5, orderBy: { createdAt: 'desc' },
          include: {
            product: { select: { id: true, name: true, sku: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        _count: { select: { stockIns: true, stockOuts: true, invoices: true } },
      },
    }),
    // Invoice (main model) ka correct count
    prisma.invoice.count({ where: { dealerId: id } }),
  ])
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  return {
    ...dealer,
    _count: {
      ...dealer._count,
      invoices: mainInvoiceCount,  // Invoice model ka count override
    },
  }
}

export const createDealer = async (data) => prisma.dealer.create({ data })

export const updateDealer = async (id, data) => {
  const dealer = await prisma.dealer.findUnique({ where: { id } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
  return prisma.dealer.update({ where: { id }, data })
}

export const deleteDealer = async (id) => {
  const dealer = await prisma.dealer.findUnique({ where: { id } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
  await prisma.dealer.update({ where: { id }, data: { isActive: false } })
}

// ─── DEALER STOCK IN ─────────────────────────────────────────────────────────
// Dealer ko stock dena = StockIn create + ProductStock deduct + serials TRANSFERRED

export const createDealerStockIn = async (dealerId, data, createdBy) => {
  const { productId, branchId, quantity, costPrice, serialNumberIds, notes, referenceNo, date } = data

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }

  if (product.hasSerialNumbers) {
    if (!serialNumberIds?.length)
      throw { statusCode: 400, message: 'Serial numbers are required for this product.' }
    if (serialNumberIds.length !== Number(quantity))
      throw { statusCode: 400, message: `Select exactly ${quantity} serial number(s).` }
  }

  const productStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId, branchId } },
  })
  const available = productStock?.currentStock ?? 0
  if (available < Number(quantity))
    throw { statusCode: 400, message: `Insufficient branch stock. Available: ${available}` }

  const result = await prisma.$transaction(async (tx) => {
    const stockIn = await tx.stockIn.create({
      data: {
        productId, branchId,
        quantity: Number(quantity),
        purchasePrice: Number(costPrice),
        dealerId,
        sourceNote: notes || `Dealer supply: ${dealer.name}`,
        referenceNo,
        date: date ? new Date(date) : new Date(),
        createdBy,
      },
      include: {
        product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } },
        branch: { select: { id: true, name: true } },
      },
    })

    if (serialNumberIds?.length) {
      const serials = await tx.serialNumber.findMany({
        where: { id: { in: serialNumberIds }, status: 'AVAILABLE', branchId },
      })
      if (serials.length !== serialNumberIds.length)
        throw { statusCode: 400, message: 'Some serial numbers are not available.' }

      // Mark TRANSFERRED + set UNBILLED billing status
      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: { status: 'TRANSFERRED', stockInId: stockIn.id, dealerBillingStatus: 'UNBILLED' },
      })
    }

    await tx.productStock.update({
      where: { productId_branchId: { productId, branchId } },
      data: { currentStock: { decrement: Number(quantity) } },
    })

    return stockIn
  })

  return prisma.stockIn.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: { select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true } },
    },
  })
}

export const getDealerStockInHistory = async (dealerId, { page = 1, limit = 20, startDate, endDate } = {}) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const where = { dealerId }
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate)
    if (endDate) where.date.lte = new Date(endDate)
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [history, total] = await Promise.all([
    prisma.stockIn.findMany({
      where, skip, take: Number(limit),
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        serialNumbers: { select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.stockIn.count({ where }),
  ])

  return {
    history,
    totalAmount: history.reduce((sum, s) => sum + s.purchasePrice * s.quantity, 0),
    totalQuantity: history.reduce((sum, s) => sum + s.quantity, 0),
    totalTransactions: total,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  }
}

// ─── DEALER STOCK SUMMARY ────────────────────────────────────────────────────

export const getDealerStockSummary = async (id) => {
  const dealer = await prisma.dealer.findUnique({ where: { id } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const stockInsRaw = await prisma.stockIn.groupBy({
    by: ['productId'],
    where: { dealerId: id },
    _sum: { quantity: true },
  })
  const stockOutsRaw = await prisma.dealerStockOut.groupBy({
    by: ['productId'],
    where: { dealerId: id },
    _sum: { quantity: true },
  })

  const stockInMap = Object.fromEntries(stockInsRaw.map(s => [s.productId, s._sum.quantity || 0]))
  const stockOutMap = Object.fromEntries(stockOutsRaw.map(s => [s.productId, s._sum.quantity || 0]))
  const allProductIds = [...new Set([...Object.keys(stockInMap), ...Object.keys(stockOutMap)])]

  const products = await prisma.product.findMany({
    where: { id: { in: allProductIds } },
    select: { id: true, name: true, sku: true, sellingPrice: true, hasSerialNumbers: true },
  })

  const summary = products.map(p => ({
    product: p,
    given: stockInMap[p.id] || 0,
    sold: stockOutMap[p.id] || 0,
    balance: (stockInMap[p.id] || 0) - (stockOutMap[p.id] || 0),
  }))

  return { summary }
}

// ─── GET DEALER SERIALS ───────────────────────────────────────────────────────

export const getDealerSerials = async (dealerId, productId, branchId) => {
  // stockIn records dhundo dealer ke — productId filter optional
  const stockInWhere = { dealerId }
  if (productId) stockInWhere.productId = productId
  // branchId sirf stockIn level pe filter karo (jis branch se diya tha)
  // serial level pe mat karo — serial ka branchId update nahi hota transfer pe
  if (branchId) stockInWhere.branchId = branchId

  const stockIns = await prisma.stockIn.findMany({
    where: stockInWhere,
    select: { id: true },
  })
  const stockInIds = stockIns.map(s => s.id)
  if (!stockInIds.length) return []

  // Sirf stockInId se link karo — branchId serial pe mat lagao
  // status TRANSFERRED = dealer ke paas hai, SOLD nahi hua abhi
  // dealerBillingStatus UNBILLED/null = invoice nahi bana abhi
  return prisma.serialNumber.findMany({
    where: {
      stockInId: { in: stockInIds },
      status: 'TRANSFERRED',
      dealerBillingStatus: { in: ['UNBILLED', null] },
      ...(productId && { productId }),
    },
    select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true },
    orderBy: { serialNumber: 'asc' },
  })
}

// ─── GET DEALER UNBILLED STOCK ────────────────────────────────────────────────
// Invoice generate karne ke liye — sirf UNBILLED serials fetch karo, grouped by product

export const getDealerUnbilledStock = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  // Get all StockIn records for this dealer
  const stockIns = await prisma.stockIn.findMany({
    where: { dealerId },
    select: { id: true, productId: true, branchId: true },
  })

  if (!stockIns.length) return { dealer, products: [] }

  const stockInIds = stockIns.map(s => s.id)

  // Fetch all UNBILLED serials (or null = old records before this feature, treat as UNBILLED)
  const unbilledSerials = await prisma.serialNumber.findMany({
    where: {
      stockInId: { in: stockInIds },
      status: 'TRANSFERRED',
      OR: [
        { dealerBillingStatus: 'UNBILLED' },
        { dealerBillingStatus: null },  // legacy records
      ],
    },
    include: {
      product: {
        select: {
          id: true, name: true, sku: true,
          sellingPrice: true, gstRate: true,
          hasSerialNumbers: true,
        },
      },
    },
    orderBy: { serialNumber: 'asc' },
  })

  if (!unbilledSerials.length) return { dealer, products: [] }

  // Group by productId
  const productMap = new Map()
  for (const serial of unbilledSerials) {
    const pid = serial.productId
    if (!productMap.has(pid)) {
      productMap.set(pid, {
        productId: pid,
        productName: serial.product.name,
        sku: serial.product.sku,
        sellingPrice: serial.product.sellingPrice,
        gstRate: serial.product.gstRate,
        hasSerialNumbers: serial.product.hasSerialNumbers,
        serials: [],
      })
    }
    productMap.get(pid).serials.push({
      id: serial.id,
      serialNumber: serial.serialNumber,
    })
  }

  const products = Array.from(productMap.values()).map(p => ({
    ...p,
    quantity: p.serials.length,
  }))

  return { dealer, products }
}

// ─── DEALER STOCK OUT ────────────────────────────────────────────────────────

export const createDealerStockOut = async (dealerId, data) => {
  const { productId, branchId, quantity, salePrice, serialNumberIds, notes, date } = data

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }

  if (product.hasSerialNumbers) {
    if (!serialNumberIds?.length)
      throw { statusCode: 400, message: 'Serial numbers must be selected for this product.' }
    if (serialNumberIds.length !== Number(quantity))
      throw { statusCode: 400, message: `Select exactly ${quantity} serial number(s).` }
  }

  const [totalIn, totalOut] = await Promise.all([
    prisma.stockIn.aggregate({ where: { dealerId, productId }, _sum: { quantity: true } }),
    prisma.dealerStockOut.aggregate({ where: { dealerId, productId }, _sum: { quantity: true } }),
  ])
  const balance = (totalIn._sum.quantity || 0) - (totalOut._sum.quantity || 0)
  if (Number(quantity) > balance)
    throw { statusCode: 400, message: `Insufficient dealer stock. Current balance: ${balance}` }

  let stockOutId
  await prisma.$transaction(async (tx) => {
    const stockOut = await tx.dealerStockOut.create({
      data: {
        dealerId, productId, branchId,
        quantity: Number(quantity),
        salePrice: Number(salePrice),
        date: date ? new Date(date) : new Date(),
        notes,
      },
    })
    stockOutId = stockOut.id

    if (serialNumberIds?.length) {
      const serials = await tx.serialNumber.findMany({
        where: { id: { in: serialNumberIds }, status: 'TRANSFERRED' },
        select: { id: true },
      })
      if (serials.length !== serialNumberIds.length)
        throw { statusCode: 400, message: 'Some serial numbers are not available with dealer.' }

      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: { status: 'SOLD', dealerStockOutId: stockOut.id },
      })
    }
  }, { timeout: 15000 })

  // Transaction ke bahar findUnique — timeout issue fix
  return prisma.dealerStockOut.findUnique({
    where: { id: stockOutId },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: { select: { id: true, serialNumber: true, status: true } },
    },
  })
}

export const getDealerStockOutHistory = async (dealerId, { page = 1, limit = 20, startDate, endDate } = {}) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const where = { dealerId }
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate)
    if (endDate) where.date.lte = new Date(endDate)
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [history, total] = await Promise.all([
    prisma.dealerStockOut.findMany({
      where, skip, take: Number(limit),
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        serialNumbers: { select: { id: true, serialNumber: true, status: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.dealerStockOut.count({ where }),
  ])

  return {
    history,
    totalAmount: history.reduce((sum, s) => sum + s.salePrice * s.quantity, 0),
    totalQuantity: history.reduce((sum, s) => sum + s.quantity, 0),
    totalTransactions: total,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  }
}

// ─── DEALER INVOICES (old DealerInvoice model — kept for backward compat) ─────

const generateDealerInvoiceNumber = async () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const count = await prisma.dealerInvoice.count()
  return `DINV-${datePart}-${String(count + 1).padStart(4, '0')}`
}

export const createDealerInvoice = async (dealerId, { items, notes, date }) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
  if (!items?.length) throw { statusCode: 400, message: 'Invoice must have at least one item.' }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map(i => i.productId) } },
    select: { id: true, name: true, sku: true },
  })
  const productMap = Object.fromEntries(products.map(p => [p.id, p]))

  const enrichedItems = items.map(item => {
    const product = productMap[item.productId]
    if (!product) throw { statusCode: 404, message: `Product not found: ${item.productId}` }
    return { productId: item.productId, productName: product.name, sku: product.sku, quantity: item.quantity, salePrice: item.salePrice, total: item.quantity * item.salePrice }
  })

  return prisma.dealerInvoice.create({
    data: {
      invoiceNumber: await generateDealerInvoiceNumber(),
      dealerId, items: enrichedItems,
      totalAmount: enrichedItems.reduce((s, i) => s + i.total, 0),
      notes,
      date: date ? new Date(date) : new Date(),
    },
    include: {
      dealer: { select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true } },
    },
  })
}

export const getDealerInvoices = async (dealerId, { page = 1, limit = 20, startDate, endDate } = {}) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const where = { dealerId }
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate)
    if (endDate) where.date.lte = new Date(endDate)
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [invoices, total] = await Promise.all([
    prisma.dealerInvoice.findMany({ where, skip, take: Number(limit), orderBy: { date: 'desc' } }),
    prisma.dealerInvoice.count({ where }),
  ])

  return {
    invoices,
    totalAmount: invoices.reduce((s, i) => s + i.totalAmount, 0),
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  }
}

export const getDealerInvoiceById = async (dealerId, invoiceId) => {
  const invoice = await prisma.dealerInvoice.findFirst({
    where: { id: invoiceId, dealerId },
    include: {
      dealer: { select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true } },
    },
  })
  if (!invoice) throw { statusCode: 404, message: 'Invoice not found.' }
  return invoice
}

// ─── GET MAIN INVOICES LINKED TO DEALER ───────────────────────────────────────
// Dealer detail page ke "Invoices" tab ke liye — proper Invoice model

export const getDealerMainInvoices = async (dealerId, { page = 1, limit = 20 } = {}) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const where = { dealerId }
  const skip = (Number(page) - 1) * Number(limit)

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where, skip, take: Number(limit),
      include: {
        stockOuts: {
          select: {
            id: true, quantity: true,
            product: { select: { name: true } },
            serialNumbers: { select: { serialNumber: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.invoice.count({ where }),
  ])

  return {
    invoices,
    totalAmount: invoices.reduce((s, i) => s + i.totalAmount, 0),
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  }
}