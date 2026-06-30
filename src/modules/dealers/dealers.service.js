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

  const dealerIds = dealers.map(d => d.id)

  // _count.invoices = DealerInvoice (old model) — Invoice (main model) se alag count karo
  const mainInvoiceCounts = await prisma.invoice.groupBy({
    by: ['dealerId'],
    where: { dealerId: { in: dealerIds } },
    _count: { id: true },
  })
  const mainInvoiceMap = Object.fromEntries(mainInvoiceCounts.map(r => [r.dealerId, r._count.id]))

  // ✅ NEW: Invoice ke andar jitne StockOut rows hain (manual + normal items),
  // unko bhi dealer ke "Sales" count mein jodo — per dealer invoices fetch karo with stockOuts count
  const invoicesWithStockOutCounts = await prisma.invoice.findMany({
    where: { dealerId: { in: dealerIds } },
    select: { dealerId: true, _count: { select: { stockOuts: true } } },
  })
  const invoiceStockOutMap = {}
  for (const inv of invoicesWithStockOutCounts) {
    invoiceStockOutMap[inv.dealerId] = (invoiceStockOutMap[inv.dealerId] || 0) + inv._count.stockOuts
  }

  const dealersWithCount = dealers.map(d => ({
    ...d,
    _count: {
      ...d._count,
      invoices: mainInvoiceMap[d.id] ?? 0,
      // ✅ DealerStockOut (direct "Record Sale") + Invoice StockOuts (manual/normal items via invoice) dono jod do
      stockOuts: (d._count.stockOuts ?? 0) + (invoiceStockOutMap[d.id] ?? 0),
    },
  }))

  return {
    dealers: dealersWithCount,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
  }
}

export const getDealerById = async (id) => {
  const [dealer, mainInvoiceCount, invoiceStockOutCount] = await Promise.all([
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
    prisma.invoice.count({ where: { dealerId: id } }),
    // ✅ NEW: invoice ke through aaye StockOut rows ka total
    prisma.stockOut.count({ where: { invoice: { dealerId: id } } }),
  ])
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  return {
    ...dealer,
    _count: {
      ...dealer._count,
      invoices: mainInvoiceCount,
      // ✅ DealerStockOut + Invoice StockOuts dono jod do
      stockOuts: (dealer._count.stockOuts ?? 0) + invoiceStockOutCount,
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

  const { branchId, ...rest } = data

  // branchId valid hai tabhi use karo, warna ignore (purana wala hi rahega)
  if (branchId) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId } })
    if (!branch) throw { statusCode: 400, message: 'Invalid branch selected.' }
    rest.branchId = branchId
  }

  return prisma.dealer.update({ where: { id }, data: rest })
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

// ─── DEALER STOCK SUMMARY 

export const getDealerStockSummary = async (dealerId) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const [stockIns, stockOuts, stockOutsThisMonth, historicalRecords, invoiceStockOuts] = await Promise.all([
    // Real StockIn (inventory se diya)
    prisma.stockIn.findMany({
      where: { dealerId },
      include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
    }),
    // Real StockOut (dealer ne becha) — "Record Sale" modal se
    prisma.dealerStockOut.findMany({
      where: { dealerId },
      include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
    }),
    // Real StockOut this month
    prisma.dealerStockOut.findMany({
      where: { dealerId, date: { gte: monthStart, lte: monthEnd } },
      select: { productId: true, quantity: true },
    }),
    // Historical stock (backdated manual entries)
    prisma.dealerHistoricalStock.findMany({
      where: { dealerId },
      include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
    }),
    // ✅ NEW: Invoice ke through hui dealer sales — normal products (productId set)
    // + manual/free-text products (productId null, sirf productName) — dono cover karo.
    // Pehle ye source query hi nahi hota tha, isliye invoice se hui sales summary
    // mein "sold: 0" dikhti thi jabki StockOutTab mein dikh rahi thi (alag source se aata hai).
    prisma.stockOut.findMany({
      where: { invoice: { dealerId } },
      select: {
        productId: true,
        productName: true,
        quantity: true,
        date: true,
        product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } },
      },
    }),
  ])

  // map key — productId agar linked hai, warna productName (free-text)
  const map = new Map()

  const getKey = (productId, productName) =>
    productId ? `pid:${productId}` : `name:${productName}`

  const ensureEntry = (key, product, productName) => {
    if (!map.has(key)) {
      map.set(key, {
        product: product || { id: null, name: productName, sku: null, hasSerialNumbers: false },
        given: 0, sold: 0, salesReturn: 0, soldInMonth: 0,
        historicalIn: 0, historicalOut: 0,
        isHistoricalOnly: !product, // inventory product nahi hai
      })
    }
  }

  // ── Real StockIn ──
  for (const si of stockIns) {
    const key = getKey(si.productId, si.product?.name)
    ensureEntry(key, si.product, si.product?.name)
    const entry = map.get(key)
    if (si.sourceNote?.toUpperCase().includes('SALES RETURN')) {
      entry.salesReturn += si.quantity
    } else {
      entry.given += si.quantity
    }
  }

  // ── Real StockOut (DealerStockOut — "Record Sale" modal) ──
  for (const so of stockOuts) {
    const key = getKey(so.productId, so.product?.name)
    ensureEntry(key, so.product, so.product?.name)
    map.get(key).sold += so.quantity
  }

  // ── Real StockOut this month ──
  for (const so of stockOutsThisMonth) {
    // productId se key dhundo map mein
    const key = `pid:${so.productId}`
    if (map.has(key)) {
      map.get(key).soldInMonth += so.quantity
    }
  }

  // ── Historical Stock ──
  for (const h of historicalRecords) {
    const key = getKey(h.productId, h.productName)
    ensureEntry(key, h.product || null, h.productName)
    const entry = map.get(key)
    if (h.type === 'IN') {
      entry.historicalIn += h.quantity
    } else {
      entry.historicalOut += h.quantity
    }
  }

  // ── ✅ NEW: Invoice StockOuts (normal + manual/free-text products) ──
  // productId hai to wahi key use karo (DealerStockOut wale hi product ke under aggregate hoga),
  // productId null hai to productName se group karo (manual product, jaisa "trying new")
  for (const so of invoiceStockOuts) {
    const productName = so.product?.name ?? so.productName
    const key = getKey(so.productId, productName)
    ensureEntry(key, so.product, productName)
    const entry = map.get(key)
    entry.sold += so.quantity

    // Sold-in-month bhi invoice sales ke liye count karo
    if (so.date && new Date(so.date) >= monthStart && new Date(so.date) <= monthEnd) {
      entry.soldInMonth += so.quantity
    }
  }

  const summary = Array.from(map.values()).map((entry) => ({
    ...entry,
    // balance = (real given + historical IN) - (real sold + historical OUT) - salesReturn
    balance:
      (entry.given + entry.historicalIn) -
      (entry.sold + entry.historicalOut) -
      entry.salesReturn,
  }))

  return { summary }
}

// ─── GET DEALER SERIALS ───────────────────────────────────────────────────────
// ─── dealers.service.js mein getDealerSerials function ko replace karo ────────

export const getDealerSerials = async (dealerId, productId, branchId, productName) => {
  // ── Pure manual product (no inventory linkage) ──
  // productId nahi diya gaya = ye sirf manual/historical product hai,
  // toh inventory-linked TRANSFERRED/DEALER_HISTORICAL serials bilkul mat fetch karo.
  if (!productId) {
    if (!productName) return []

    const historicalStringRecords = await prisma.dealerHistoricalStock.findMany({
      where: {
        dealerId,
        productId: null,            // sirf manual free-text wale
        productName,                // exact match — sirf selected product ke
        type: 'IN',
        serialNumbers: { isEmpty: false },
      },
      select: {
        id: true,
        serialNumbers: true,
        usedSerialNumbers: true,
      },
    })

    const manualSerials = []
    for (const hist of historicalStringRecords) {
      const usedSet = new Set(hist.usedSerialNumbers || [])
      for (const sn of hist.serialNumbers) {
        if (!usedSet.has(sn)) {
          manualSerials.push({
            id: `hist_${hist.id}_${sn}`,
            serialNumber: sn,
            status: 'DEALER_HISTORICAL',
            dealerBillingStatus: null,
            historicalStockId: hist.id,
            isManual: true,
          })
        }
      }
    }

    return manualSerials
  }

  // ── productId diya gaya = inventory-linked product ──
  const stockInWhere = { dealerId, productId }
  if (branchId) stockInWhere.branchId = branchId

  const stockIns = await prisma.stockIn.findMany({
    where: stockInWhere,
    select: { id: true },
  })
  const stockInIds = stockIns.map(s => s.id)

  const [transferredSerials, historicalSerialRecords] = await Promise.all([
    // ── Real TRANSFERRED serials (inventory wala flow) ──
    stockInIds.length
      ? prisma.serialNumber.findMany({
          where: {
            stockInId: { in: stockInIds },
            status: 'TRANSFERRED',
            productId,
          },
          select: {
            id: true, serialNumber: true, status: true,
            dealerBillingStatus: true, historicalStockId: true,
          },
          orderBy: { serialNumber: 'asc' },
        })
      : [],

    // ── Historical SerialNumber records (productId linked wale) ──
    prisma.serialNumber.findMany({
      where: {
        productId,
        status: 'DEALER_HISTORICAL',
        historicalStock: { dealerId },
      },
      select: {
        id: true, serialNumber: true, status: true,
        dealerBillingStatus: true, historicalStockId: true,
      },
      orderBy: { serialNumber: 'asc' },
    }),
  ])

  return [...transferredSerials, ...historicalSerialRecords]
}

// ─── GET DEALER UNBILLED STOCK ────────────────────────────────────────────────
// Invoice generate karne ke liye — sirf UNBILLED serials fetch karo, grouped by product

// dealers.service.js — getDealerUnbilledStock
export const getDealerUnbilledStock = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  // ── Existing: real inventory serials (TRANSFERRED + UNBILLED) ──
  const stockIns = await prisma.stockIn.findMany({
    where: { dealerId },
    select: { id: true, productId: true, branchId: true },
  })

  const stockInIds = stockIns.map(s => s.id)
  
  const unbilledSerials = stockInIds.length
    ? await prisma.serialNumber.findMany({
        where: {
          stockInId: { in: stockInIds },
          status: 'TRANSFERRED',
          OR: [{ dealerBillingStatus: 'UNBILLED' }, { dealerBillingStatus: null }],
        },
        include: {
          product: {
            select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true, hasSerialNumbers: true },
          },
        },
        orderBy: { serialNumber: 'asc' },
      })
    : []

  // ── NEW: Historical stock products ──
  // Jinke serials DEALER_HISTORICAL status mein hain (productId linked)
  const historicalLinkedSerials = await prisma.serialNumber.findMany({
    where: {
      status: 'DEALER_HISTORICAL',
      dealerBillingStatus: 'UNBILLED',
      historicalStock: { dealerId },
    },
    include: {
      product: {
        select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true, hasSerialNumbers: true },
      },
    },
    orderBy: { serialNumber: 'asc' },
  })

  // ── NEW: Manual/free-text historical products (productId: null) ──
  // Balance = histIN - histOUT per productName
  const manualHistoricals = await prisma.dealerHistoricalStock.findMany({
    where: { dealerId, productId: null, type: 'IN' },
    select: {
      id: true,
      productName: true,
      serialNumbers: true,
      usedSerialNumbers: true,
      purchasePrice: true,
      salePrice: true,
      quantity: true,
    },
  })

  // OUT records bhi fetch karo balance ke liye
  const manualOuts = await prisma.dealerHistoricalStock.findMany({
    where: { dealerId, productId: null, type: 'OUT' },
    select: { productName: true, quantity: true },
  })

  // ── Group: inventory serial products ──
  const productMap = new Map()

  for (const serial of unbilledSerials) {
    const pid = serial.productId
    if (!productMap.has(pid)) {
      productMap.set(pid, {
        type: 'inventory',
        productId: pid,
        productName: serial.product.name,
        sku: serial.product.sku,
        sellingPrice: serial.product.sellingPrice,
        gstRate: serial.product.gstRate,
        hasSerialNumbers: serial.product.hasSerialNumbers,
        serials: [],
      })
    }
    productMap.get(pid).serials.push({ id: serial.id, serialNumber: serial.serialNumber, type: 'transferred' })
  }

  // ── Group: historical linked serials (DEALER_HISTORICAL, productId linked) ──
  for (const serial of historicalLinkedSerials) {
    const pid = serial.productId
    const key = `hist_linked_${pid}`
    if (!productMap.has(key)) {
      productMap.set(key, {
        type: 'historical_linked',
        productId: pid,
        productName: serial.product.name,
        sku: serial.product.sku,
        sellingPrice: serial.product.sellingPrice,
        gstRate: serial.product.gstRate,
        hasSerialNumbers: true,
        serials: [],
      })
    }
    productMap.get(key).serials.push({
      id: serial.id,
      serialNumber: serial.serialNumber,
      type: 'dealer_historical',
      historicalStockId: serial.historicalStockId,
    })
  }

  // ── Manual free-text products ──
  // productName se group karo, balance calculate karo
  const manualOutMap = {}
  for (const out of manualOuts) {
    manualOutMap[out.productName] = (manualOutMap[out.productName] || 0) + out.quantity
  }

  const manualProductMap = new Map() // key: productName
  for (const hist of manualHistoricals) {
    const pName = hist.productName
    if (!manualProductMap.has(pName)) {
      manualProductMap.set(pName, {
        type: 'manual',
        productId: null,
        productName: pName,
        sku: null,
        sellingPrice: hist.salePrice || 0,
        gstRate: 0,
        hasSerialNumbers: false,
        totalIn: 0,
        totalOut: manualOutMap[pName] || 0,
        serials: [],
        histRecords: [],
      })
    }
    const entry = manualProductMap.get(pName)
    entry.totalIn += hist.quantity
    entry.histRecords.push(hist)

    // Available serials
    const usedSet = new Set(hist.usedSerialNumbers || [])
    for (const sn of hist.serialNumbers) {
      if (!usedSet.has(sn)) {
        entry.serials.push({
          id: `hist_${hist.id}_${sn}`,
          serialNumber: sn,
          type: 'manual',
        })
        entry.hasSerialNumbers = true
      }
    }
  }

  // Combine sab products
  const inventoryProducts = Array.from(productMap.values()).map(p => ({
    ...p,
    quantity: p.serials.length || 0,
  }))

  const manualProducts = Array.from(manualProductMap.values())
    .filter(p => {
      const balance = p.totalIn - p.totalOut
      return balance > 0
    })
    .map(p => {
      const balance = p.totalIn - p.totalOut
      const { histRecords, totalIn, totalOut, ...rest } = p
      return {
        ...rest,
        quantity: p.hasSerialNumbers ? p.serials.length : balance,
      }
    })

  return { dealer, products: [...inventoryProducts, ...manualProducts] }
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

  // ── Serial IDs classify karo — real vs manual ──
  // Manual IDs format: "hist_{historicalStockId}_{serialNumber}"
  const realSerialIds = (serialNumberIds || []).filter(id => !id.startsWith('hist_'))
  const manualSerialEntries = (serialNumberIds || [])
    .filter(id => id.startsWith('hist_'))
    .map(id => {
      const parts = id.split('_')
      // format: hist_{histId}_{serialNumber} — histId mein underscore ho sakta hai (cuid)
      // pehla part = 'hist', doosra = histId, teesra onwards = serialNumber
      const histId = parts[1]
      const sn = parts.slice(2).join('_')
      return { histId, sn }
    })

  // Balance check — historical bhi include karo
  const [realIn, realOut, histIn, histOut] = await Promise.all([
    prisma.stockIn.aggregate({ where: { dealerId, productId }, _sum: { quantity: true } }),
    prisma.dealerStockOut.aggregate({ where: { dealerId, productId }, _sum: { quantity: true } }),
    prisma.dealerHistoricalStock.aggregate({
      where: { dealerId, productId, type: 'IN' },
      _sum: { quantity: true },
    }),
    prisma.dealerHistoricalStock.aggregate({
      where: { dealerId, productId, type: 'OUT' },
      _sum: { quantity: true },
    }),
  ])
  const balance =
    ((realIn._sum.quantity || 0) + (histIn._sum.quantity || 0)) -
    ((realOut._sum.quantity || 0) + (histOut._sum.quantity || 0))

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

    // ── Real SerialNumber records (TRANSFERRED / DEALER_HISTORICAL) ──
    if (realSerialIds.length) {
      const serials = await tx.serialNumber.findMany({
        where: {
          id: { in: realSerialIds },
          status: { in: ['TRANSFERRED', 'DEALER_HISTORICAL'] },
        },
        select: { id: true, status: true, serialNumber: true, historicalStockId: true },
      })

      if (serials.length !== realSerialIds.length)
        throw { statusCode: 400, message: 'Some serial numbers are not available with dealer.' }

      await tx.serialNumber.updateMany({
        where: { id: { in: realSerialIds } },
        data: { status: 'SOLD', dealerStockOutId: stockOut.id },
      })

      // Historical SerialNumber records ke liye quantity deduct
      const historicalOnes = serials.filter(s => s.status === 'DEALER_HISTORICAL')
      if (historicalOnes.length) {
        const grouped = {}
        for (const s of historicalOnes) {
          if (!s.historicalStockId) continue
          if (!grouped[s.historicalStockId]) grouped[s.historicalStockId] = []
          grouped[s.historicalStockId].push(s.serialNumber)
        }
        for (const [histId, sns] of Object.entries(grouped)) {
          await tx.dealerHistoricalStock.update({
            where: { id: histId },
            data: {
              quantity: { decrement: sns.length },
              usedSerialNumbers: { push: sns },
            },
          })
        }
      }
    }

    // ── Manual string serials (hist_ prefix wale) ──
    if (manualSerialEntries.length) {
      // Group by histId
      const grouped = {}
      for (const { histId, sn } of manualSerialEntries) {
        if (!grouped[histId]) grouped[histId] = []
        grouped[histId].push(sn)
      }

      for (const [histId, sns] of Object.entries(grouped)) {
        // Verify — ye serials is hist record mein hain aur used nahi hain
        const hist = await tx.dealerHistoricalStock.findFirst({
          where: { id: histId, dealerId },
          select: { id: true, serialNumbers: true, usedSerialNumbers: true, quantity: true },
        })
        if (!hist) throw { statusCode: 400, message: 'Historical record not found.' }

        const usedSet = new Set(hist.usedSerialNumbers || [])
        for (const sn of sns) {
          if (!hist.serialNumbers.includes(sn))
            throw { statusCode: 400, message: `Serial ${sn} not found in historical record.` }
          if (usedSet.has(sn))
            throw { statusCode: 400, message: `Serial ${sn} already used.` }
        }

        await tx.dealerHistoricalStock.update({
          where: { id: histId },
          data: {
            quantity: { decrement: sns.length },
            usedSerialNumbers: { push: sns },
          },
        })
      }
    }
  }, { timeout: 15000 })

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
            sellingPrice: true,
            // ✅ manual products ke liye productName, product null ho sakta hai ab
            productName: true,
            product: { select: { name: true } },
            serialNumbers: { select: { id: true, serialNumber: true } },
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
 

// ─── DEALERS OVERVIEW STATS (list page ke top stats ke liye) ─────────────────
// Total Wholesale Revenue, Total Sale, Products in Hand, Low Stock Items, All Profit

export const getDealersOverviewStats = async (branchId) => {
  const stockInWhere = { dealerId: { not: null }, ...(branchId && { branchId }) }
  const stockOutWhere = { ...(branchId && { branchId }) }

  const [allStockIns, allStockOuts] = await Promise.all([
    prisma.stockIn.findMany({
      where: stockInWhere,
      select: { dealerId: true, productId: true, quantity: true, purchasePrice: true, sourceNote: true },
    }),
    prisma.dealerStockOut.findMany({
      where: stockOutWhere,
      select: { dealerId: true, productId: true, quantity: true, salePrice: true },
    }),
  ])

  // ── Wholesale Revenue (humne dealers ko diya — cost value) ──
  // Sales return wale StockIn exclude karo (woh wapas aaya stock hai, naya supply nahi)
  const realStockIns = allStockIns.filter(
    si => !si.sourceNote?.toUpperCase().includes('SALES RETURN')
  )
  const totalWholesaleRevenue = realStockIns.reduce(
    (sum, si) => sum + si.purchasePrice * si.quantity, 0
  )

  // ── Total Sale (dealers ne aage becha) ──
  const totalSale = allStockOuts.reduce(
    (sum, so) => sum + so.salePrice * so.quantity, 0
  )

  // ── All Profit = Total Sale − Total Wholesale Revenue ──
  const allProfit = totalSale - totalWholesaleRevenue

  // ── Products in Hand + Low Stock (per dealer+product balance) ──
  const balanceMap = new Map() // key: dealerId::productId

  for (const si of allStockIns) {
    const key = `${si.dealerId}::${si.productId}`
    if (!balanceMap.has(key)) balanceMap.set(key, { given: 0, sold: 0, returned: 0 })
    const entry = balanceMap.get(key)
    if (si.sourceNote?.toUpperCase().includes('SALES RETURN')) {
      entry.returned += si.quantity
    } else {
      entry.given += si.quantity
    }
  }

  for (const so of allStockOuts) {
    const key = `${so.dealerId}::${so.productId}`
    if (!balanceMap.has(key)) balanceMap.set(key, { given: 0, sold: 0, returned: 0 })
    balanceMap.get(key).sold += so.quantity
  }

  let productsInHand = 0
  let lowStockItems = 0
  const LOW_STOCK_THRESHOLD = 2 // ✅ tum chaho to badal sakte ho

  for (const entry of balanceMap.values()) {
    const balance = entry.given - entry.sold - entry.returned
    if (balance > 0) {
      productsInHand += balance
      if (balance <= LOW_STOCK_THRESHOLD) lowStockItems++
    }
  }

  return {
    totalWholesaleRevenue,
    totalSale,
    allProfit,
    productsInHand,
    lowStockItems,
  }
}

// ─── DEALER HISTORICAL STOCK  

export const addDealerHistoricalStock = async (dealerId, data) => {
  const {
    productId, 
    productName,    
    serialNumbers,  
    type,         
    quantity,
    purchasePrice,
    salePrice,
    date,
    notes,
  } = data

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  
  if (type === 'OUT') {
    const [realIn, realOut, histIn, histOut] = await Promise.all([
      
      prisma.stockIn.aggregate({
        where: { dealerId, ...(productId && { productId }) },
        _sum: { quantity: true },
      }),
      
      prisma.dealerStockOut.aggregate({
        where: { dealerId, ...(productId && { productId }) },
        _sum: { quantity: true },
      }),
    
      prisma.dealerHistoricalStock.aggregate({
        where: {
          dealerId,
          type: 'IN',
          ...(productId
            ? { productId }
            : { productName, productId: null }),
        },
        _sum: { quantity: true },
      }),
      // Historical OUT records
      prisma.dealerHistoricalStock.aggregate({
        where: {
          dealerId,
          type: 'OUT',
          ...(productId
            ? { productId }
            : { productName, productId: null }),
        },
        _sum: { quantity: true },
      }),
    ])

    const totalIn  = (realIn._sum.quantity || 0)  + (histIn._sum.quantity || 0)
    const totalOut = (realOut._sum.quantity || 0) + (histOut._sum.quantity || 0)
    const balance  = totalIn - totalOut

    if (Number(quantity) > balance) {
      throw {
        statusCode: 400,
        message: `Insufficient dealer balance. Current: ${balance}`,
      }
    }
  }

  // productId diya hai to product exist karta hai verify karo
  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) throw { statusCode: 404, message: 'Product not found.' }
  }

   const branch = await prisma.branch.findFirst({
    where: productId
      ? { productStocks: { some: { productId } } }
      : {},
    select: { id: true },
  })
  const branchId = dealer.branchId || branch?.id


  const record = await prisma.$transaction(async (tx) => {
    // Historical record create karo
    const hist = await tx.dealerHistoricalStock.create({
      data: {
        dealerId,
        productId: productId || null,
        productName,
        serialNumbers: serialNumbers || [],
        type,
        quantity: Number(quantity),
        purchasePrice: Number(purchasePrice) || 0,
        salePrice: Number(salePrice) || 0,
        date: date ? new Date(date) : new Date(),
        notes: notes || null,
      },
    })

    // ✅ Sirf IN type + serial numbers hain + productId linked hai to SerialNumber records banao
    if (type === 'IN' && serialNumbers?.length && productId && branchId) {
      await tx.serialNumber.createMany({
        data: serialNumbers.map(sn => ({
          serialNumber: sn.trim().toUpperCase(),
          productId,
          branchId,
          status: 'DEALER_HISTORICAL',
          historicalStockId: hist.id,
          dealerBillingStatus: 'UNBILLED',
        })),
        skipDuplicates: true, // agar pehle se exist karta hai to skip
      })
    }

    return hist
  })

  return prisma.dealerHistoricalStock.findUnique({
    where: { id: record.id },
    include: {
      dealer: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, sku: true } },
      serialNumberRecords: {
        select: { id: true, serialNumber: true, status: true },
      },
    },
  })
}



export const getDealerHistoricalStock = async (dealerId, { page = 1, limit = 20, type } = {}) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const where = {
    dealerId,
    ...(type && { type }),
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [records, total] = await Promise.all([
    prisma.dealerHistoricalStock.findMany({
      where,
      skip,
      take: Number(limit),
      include: {
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.dealerHistoricalStock.count({ where }),
  ])

  return {
    records,
    pagination: {
      total,
      page:  Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  }
}

export const deleteDealerHistoricalStock = async (dealerId, recordId) => {
  const record = await prisma.dealerHistoricalStock.findFirst({
    where: { id: recordId, dealerId },
  })
  if (!record) throw { statusCode: 404, message: 'Record not found.' }

  await prisma.dealerHistoricalStock.delete({ where: { id: recordId } })
}

// ─── DEALER STOCK OUT (MANUAL / FREE-TEXT PRODUCT) ───────────────────────────
// productId nahi hai — sirf historical/manual product hai. DealerStockOut
// table mein productId required hai, isliye yahan DealerHistoricalStock
// (type: OUT) banate hain, jaisa addDealerHistoricalStock OUT case mein hota hai.

export const createDealerManualStockOut = async (dealerId, data) => {
  const { productName, quantity, salePrice, serialNumberIds, notes, date } = data

  if (!productName) throw { statusCode: 400, message: 'Product name is required for manual sale.' }

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  // ── Manual serial IDs classify karo: format "hist_{historicalStockId}_{serialNumber}"
  const manualSerialEntries = (serialNumberIds || [])
    .filter(id => id.startsWith('hist_'))
    .map(id => {
      const parts = id.split('_')
      const histId = parts[1]
      const sn = parts.slice(2).join('_')
      return { histId, sn }
    })

  if ((serialNumberIds || []).length && manualSerialEntries.length !== serialNumberIds.length)
    throw { statusCode: 400, message: 'Invalid serial number selected for manual product.' }

  // ── Balance check — productName se (productId null hai) ──
  const [histIn, histOut] = await Promise.all([
    prisma.dealerHistoricalStock.aggregate({
      where: { dealerId, productId: null, productName, type: 'IN' },
      _sum: { quantity: true },
    }),
    prisma.dealerHistoricalStock.aggregate({
      where: { dealerId, productId: null, productName, type: 'OUT' },
      _sum: { quantity: true },
    }),
  ])
  const balance = (histIn._sum.quantity || 0) - (histOut._sum.quantity || 0)
  if (Number(quantity) > balance)
    throw { statusCode: 400, message: `Insufficient dealer balance. Current: ${balance}` }

  if (manualSerialEntries.length && manualSerialEntries.length !== Number(quantity))
    throw { statusCode: 400, message: `Select exactly ${quantity} serial number(s).` }

  const record = await prisma.$transaction(async (tx) => {
    // Historical OUT record create karo (sale)
    const hist = await tx.dealerHistoricalStock.create({
      data: {
        dealerId,
        productId: null,
        productName,
        serialNumbers: manualSerialEntries.map(e => e.sn),
        type: 'OUT',
        quantity: Number(quantity),
        salePrice: Number(salePrice) || 0,
        date: date ? new Date(date) : new Date(),
        notes: notes || null,
      },
    })

    // ── Used serials ko respective IN record(s) mein mark karo ──
    if (manualSerialEntries.length) {
      const grouped = {}
      for (const { histId, sn } of manualSerialEntries) {
        if (!grouped[histId]) grouped[histId] = []
        grouped[histId].push(sn)
      }

      for (const [histId, sns] of Object.entries(grouped)) {
        const sourceHist = await tx.dealerHistoricalStock.findFirst({
          where: { id: histId, dealerId },
          select: { id: true, serialNumbers: true, usedSerialNumbers: true },
        })
        if (!sourceHist) throw { statusCode: 400, message: 'Historical record not found.' }

        const usedSet = new Set(sourceHist.usedSerialNumbers || [])
        for (const sn of sns) {
          if (!sourceHist.serialNumbers.includes(sn))
            throw { statusCode: 400, message: `Serial ${sn} not found in historical record.` }
          if (usedSet.has(sn))
            throw { statusCode: 400, message: `Serial ${sn} already used.` }
        }

        await tx.dealerHistoricalStock.update({
          where: { id: histId },
          data: {
            quantity: { decrement: sns.length },
            usedSerialNumbers: { push: sns },
          },
        })
      }
    }

    return hist
  }, { timeout: 15000 })

  return prisma.dealerHistoricalStock.findUnique({
    where: { id: record.id },
    include: { dealer: { select: { id: true, name: true } } },
  })
}


// ─── GET DEALER ASSIGNED PRODUCTS (ALL — billed + unbilled) ──────────────────
// Invoice create/edit modal ke "Add Product" button ke liye — dealer ko kabhi
// bhi assign hue saare products dikhane hain, sirf unbilled nahi.
export const getDealerAssignedProducts = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  // ── 1. Inventory-linked products — saare StockIn se distinct productId ──
  const stockIns = await prisma.stockIn.findMany({
    where: { dealerId },
    select: { id: true, productId: true },
  })
  const stockInIds = stockIns.map(s => s.id)
  const productIds = [...new Set(stockIns.map(s => s.productId))]

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true, hasSerialNumbers: true },
      })
    : []
  const productMap = Object.fromEntries(products.map(p => [p.id, p]))

  // ── Saare real serials (TRANSFERRED ya SOLD, dono dikhao — status info ke saath) ──
  const allRealSerials = stockInIds.length
    ? await prisma.serialNumber.findMany({
        where: { stockInId: { in: stockInIds } },
        select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true, productId: true },
        orderBy: { serialNumber: 'asc' },
      })
    : []

  // ── DEALER_HISTORICAL linked serials (productId set wale) ──
  const historicalLinkedSerials = await prisma.serialNumber.findMany({
    where: { historicalStock: { dealerId } },
    select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true, productId: true, historicalStockId: true },
    orderBy: { serialNumber: 'asc' },
  })

  const inventoryMap = new Map()
  for (const pid of productIds) {
    const p = productMap[pid]
    if (!p) continue
    inventoryMap.set(pid, {
      type: 'inventory',
      productId: pid,
      productName: p.name,
      sku: p.sku,
      sellingPrice: p.sellingPrice,
      gstRate: p.gstRate,
      hasSerialNumbers: p.hasSerialNumbers,
      serials: [],
    })
  }
  for (const s of allRealSerials) {
    if (!inventoryMap.has(s.productId)) continue
    inventoryMap.get(s.productId).serials.push({
      id: s.id, serialNumber: s.serialNumber, type: 'transferred',
      billed: s.status === 'SOLD' || s.dealerBillingStatus === 'BILLED',
    })
  }
  for (const s of historicalLinkedSerials) {
    const key = `hist_${s.productId}`
    if (!inventoryMap.has(key)) {
      const p = productMap[s.productId] || (await prisma.product.findUnique({
        where: { id: s.productId },
        select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true, hasSerialNumbers: true },
      }))
      if (!p) continue
      inventoryMap.set(key, {
        type: 'historical_linked', productId: p.id, productName: p.name, sku: p.sku,
        sellingPrice: p.sellingPrice, gstRate: p.gstRate, hasSerialNumbers: true, serials: [],
      })
    }
    inventoryMap.get(key).serials.push({
      id: s.id, serialNumber: s.serialNumber, type: 'dealer_historical',
      historicalStockId: s.historicalStockId,
      billed: s.status === 'SOLD' || s.dealerBillingStatus === 'BILLED',
    })
  }

  // ── 2. Manual/free-text products — saare history records, IN-OUT dono ──
  const manualRecords = await prisma.dealerHistoricalStock.findMany({
    where: { dealerId, productId: null },
    select: { id: true, productName: true, type: true, quantity: true, salePrice: true, serialNumbers: true, usedSerialNumbers: true },
  })

  const manualMap = new Map()
  for (const r of manualRecords) {
    if (!manualMap.has(r.productName)) {
      manualMap.set(r.productName, {
        type: 'manual', productId: null, productName: r.productName, sku: null,
        sellingPrice: r.salePrice || 0, gstRate: 0, hasSerialNumbers: false,
        serials: [], totalIn: 0, totalOut: 0,
      })
    }
    const entry = manualMap.get(r.productName)
    if (r.type === 'IN') {
      entry.totalIn += r.quantity
      const usedSet = new Set(r.usedSerialNumbers || [])
      for (const sn of r.serialNumbers || []) {
        entry.serials.push({
          id: `hist_${r.id}_${sn}`, serialNumber: sn, type: 'manual',
          historicalStockId: r.id, billed: usedSet.has(sn),
        })
        entry.hasSerialNumbers = true
      }
    } else {
      entry.totalOut += r.quantity
    }
  }

  const inventoryProducts = Array.from(inventoryMap.values()).map(p => ({ ...p, quantity: p.serials.length }))
  const manualProducts = Array.from(manualMap.values())
    .filter(p => p.totalIn > 0) // kabhi assign hua ho
    .map(p => {
      const { totalIn, totalOut, ...rest } = p
      return { ...rest, quantity: p.hasSerialNumbers ? p.serials.length : (totalIn - totalOut) }
    })

  return { dealer, products: [...inventoryProducts, ...manualProducts] }
}