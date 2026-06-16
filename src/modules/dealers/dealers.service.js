import prisma from '../../config/db.js'

// ─── DEALERS CRUD ────────────────────────────────────────────────────────────

const getDealerProductBalance = async (dealerId, productId) => {
  const stockIns = await prisma.stockIn.findMany({
    where: { dealerId, productId },
    select: { quantity: true, sourceNote: true },
  })
 
  const totalGiven = stockIns
    .filter(si => !si.sourceNote?.toUpperCase().includes('SALES RETURN'))
    .reduce((sum, si) => sum + si.quantity, 0)
 
  const totalOut = await prisma.dealerStockOut.aggregate({
    where: { dealerId, productId },
    _sum: { quantity: true },
  })
 
  return totalGiven - (totalOut._sum.quantity || 0)
}
 

export const getAllDealers = async ({ page = 1, limit = 20, search, branchId } = {}) => {
  const skip = (page - 1) * limit
  const where = {
    isActive: true,
    ...(branchId && { branchId }),           
    ...(search && {
      OR: [
        { name:      { contains: search, mode: 'insensitive' } },
        { phone:     { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { gstNumber: { contains: search, mode: 'insensitive' } },
      ],
    }),
  }

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

export const createDealer = async (data) => {
  const { branchId, ...rest } = data
  return prisma.dealer.create({
    data: {
      ...rest,
      ...(branchId && { branchId }),    
    },
  })
}

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

// export const getDealerStockSummary = async (dealerId) => {
//   const now = new Date()
//   const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
//   const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

//   const stockIns = await prisma.stockIn.findMany({
//     where: { dealerId },
// include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
//   })

//   const stockOuts = await prisma.dealerStockOut.findMany({
//     where: { dealerId },
//     include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
//   })

//   const stockOutsThisMonth = await prisma.dealerStockOut.findMany({
//     where: { dealerId, date: { gte: monthStart, lte: monthEnd } },
//     select: { productId: true, quantity: true },
//   })

//   const map = new Map()

//   for (const si of stockIns) {
//     const pid = si.productId
//     if (!map.has(pid)) {
//       map.set(pid, { product: si.product, given: 0, sold: 0, balance: 0, soldInMonth: 0, salesReturn: 0 })
//     }
//     const entry = map.get(pid)
//     if (si.sourceNote?.toUpperCase().includes('RETURN')) {
//       entry.salesReturn += si.quantity
//     } else {
//       entry.given += si.quantity
//     }
//   }

//   for (const so of stockOuts) {
//     const pid = so.productId
//     if (!map.has(pid)) {
//       map.set(pid, { product: so.product, given: 0, sold: 0, balance: 0, soldInMonth: 0, salesReturn: 0 })
//     }
//     map.get(pid).sold += so.quantity
//   }

//   for (const so of stockOutsThisMonth) {
//     if (map.has(so.productId)) {
//       map.get(so.productId).soldInMonth += so.quantity
//     }
//   }

//   const summary = Array.from(map.values()).map((entry) => ({
//     ...entry,
//     balance: entry.given - entry.sold + entry.salesReturn,
//   }))

//   return { summary }
// }

export const getDealerStockSummary = async (dealerId) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
 
  const stockIns = await prisma.stockIn.findMany({
    where: { dealerId },
    include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
  })
 
  const stockOuts = await prisma.dealerStockOut.findMany({
    where: { dealerId },
    include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
  })
 
  const stockOutsThisMonth = await prisma.dealerStockOut.findMany({
    where: { dealerId, date: { gte: monthStart, lte: monthEnd } },
    select: { productId: true, quantity: true },
  })
 
  const map = new Map()
 
  for (const si of stockIns) {
    const pid = si.productId
    if (!map.has(pid)) {
      map.set(pid, { product: si.product, given: 0, sold: 0, balance: 0, soldInMonth: 0, salesReturn: 0 })
    }
    const entry = map.get(pid)
    if (si.sourceNote?.toUpperCase().includes('SALES RETURN')) {
      // Return = stock wapas branch mein gaya, dealer ke balance mein COUNT NAHI hoga
      entry.salesReturn += si.quantity
    } else {
      entry.given += si.quantity
    }
  }
 
  for (const so of stockOuts) {
    const pid = so.productId
    if (!map.has(pid)) {
      map.set(pid, { product: so.product, given: 0, sold: 0, balance: 0, soldInMonth: 0, salesReturn: 0 })
    }
    map.get(pid).sold += so.quantity
  }
 
  for (const so of stockOutsThisMonth) {
    if (map.has(so.productId)) {
      map.get(so.productId).soldInMonth += so.quantity
    }
  }
 
  const summary = Array.from(map.values()).map((entry) => ({
    ...entry,
    // FIX: balance = given - sold only
    // salesReturn dealer ke balance mein add nahi hoga
    // (returned stock branch mein wapas aa gaya — dealer ke paas nahi)
    balance: entry.given - entry.sold - entry.salesReturn,
  }))
 
  return { summary }
}

// ─── GET DEALER SERIALS ───────────────────────────────────────────────────────
export const getDealerSerials = async (dealerId, productId, branchId) => {
  const stockInWhere = { dealerId }
  if (productId) stockInWhere.productId = productId
  if (branchId) stockInWhere.branchId = branchId

  const stockIns = await prisma.stockIn.findMany({
    where: stockInWhere,
    select: { id: true },
  })
  const stockInIds = stockIns.map(s => s.id)
  if (!stockInIds.length) return []

  return prisma.serialNumber.findMany({
    where: {
      stockInId: { in: stockInIds },
      status: 'TRANSFERRED',
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



export const createDealerSalesReturn = async (dealerId, data, createdBy) => {
  const { productId, branchId, quantity, serialNumberIds, notes, date } = data
 
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
 
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }
 
  // Serial product ke liye serialNumberIds mandatory
  if (product.hasSerialNumbers) {
    if (!serialNumberIds?.length)
      throw { statusCode: 400, message: 'Serial numbers are required for this product.' }
    if (serialNumberIds.length !== Number(quantity))
      throw { statusCode: 400, message: `Select exactly ${quantity} serial number(s).` }
  }
 
  // Check dealer ke paas itna balance hai?
  const [totalIn, totalOut] = await Promise.all([
    prisma.stockIn.aggregate({ where: { dealerId, productId }, _sum: { quantity: true } }),
    prisma.dealerStockOut.aggregate({ where: { dealerId, productId }, _sum: { quantity: true } }),
  ])
  const dealerBalance = (totalIn._sum.quantity || 0) - (totalOut._sum.quantity || 0)
  if (Number(quantity) > dealerBalance)
    throw { statusCode: 400, message: `Dealer balance insufficient for return. Current balance: ${dealerBalance}` }
 
  // Branchwise ProductStock exist karna chahiye (upsert safe hai)
  const productStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId, branchId } },
  })
 
  let stockInId
  await prisma.$transaction(async (tx) => {
    // StockIn create — sourceNote "SALES RETURN:" se shuru karo taaki summary mein count ho
    const stockIn = await tx.stockIn.create({
      data: {
        productId,
        branchId,
        quantity: Number(quantity),
        purchasePrice: 0, // return hai, cost 0
        dealerId,
        sourceNote: `SALES RETURN: ${dealer.name}${notes ? ' — ' + notes : ''}`,
        date: date ? new Date(date) : new Date(),
        createdBy,
      },
    })
    stockInId = stockIn.id
 
    if (product.hasSerialNumbers && serialNumberIds?.length) {
      // Verify — ye serials TRANSFERRED hain aur is dealer ke stockIn se linked hain
      const dealerStockInIds = await tx.stockIn.findMany({
        where: { dealerId, productId },
        select: { id: true },
      })
      const validStockInIds = dealerStockInIds.map(s => s.id)
 
      const serials = await tx.serialNumber.findMany({
        where: {
          id: { in: serialNumberIds },
          status: 'TRANSFERRED',
          stockInId: { in: validStockInIds },
        },
        select: { id: true },
      })
      if (serials.length !== serialNumberIds.length)
        throw { statusCode: 400, message: 'Some serial numbers are not valid / not with this dealer.' }
 
      // Reset serials → AVAILABLE, clear dealer fields, link to new stockIn
      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: {
          status: 'AVAILABLE',
          dealerBillingStatus: null,
          dealerInvoiceId: null,
          dealerStockOutId: null,
          stockInId: stockIn.id, // naye return stockIn se link
        },
      })
    }
 
    // ProductStock branch mein increment
    if (productStock) {
      await tx.productStock.update({
        where: { productId_branchId: { productId, branchId } },
        data: { currentStock: { increment: Number(quantity) } },
      })
    } else {
      // ProductStock exist nahi karta → create karo
      await tx.productStock.create({
        data: { productId, branchId, currentStock: Number(quantity) },
      })
    }
  }, { timeout: 15000 })
 
  return prisma.stockIn.findUnique({
    where: { id: stockInId },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: { select: { id: true, serialNumber: true, status: true } },
    },
  })
}
 