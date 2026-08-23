import prisma from '../../config/db.js'
import ExcelJS from 'exceljs'

// ─── DEALERS CRUD ────────────────────────────────────────────────────────────

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
      include: { _count: { select: { stockIns: true, invoices: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.dealer.count({ where }),
  ])

  const dealerIds = dealers.map(d => d.id)

  const mainInvoiceCounts = await prisma.invoice.groupBy({
    by: ['dealerId'],
    where: { dealerId: { in: dealerIds } },
    _count: { id: true },
  })
  const mainInvoiceMap = Object.fromEntries(mainInvoiceCounts.map(r => [r.dealerId, r._count.id]))

  const invoicesWithStockOutCounts = await prisma.invoice.findMany({
    where: { dealerId: { in: dealerIds } },
    select: { dealerId: true, _count: { select: { stockOuts: true } } },
  })
  const invoiceStockOutMap = {}
  for (const inv of invoicesWithStockOutCounts) {
    invoiceStockOutMap[inv.dealerId] = (invoiceStockOutMap[inv.dealerId] || 0) + inv._count.stockOuts
  }

  // ✅ Sirf 2 source: (1) real StockIn — dealer ko diya gaya stock, (2) Invoice — actual sale
  const [dealerStockIns, dealerInvoiceStockOuts, dealerHistoricalIn] = await Promise.all([
    prisma.stockIn.findMany({
      where: { dealerId: { in: dealerIds } },
      select: { dealerId: true, productId: true, quantity: true, purchasePrice: true, mrp: true, sourceNote: true },
    }),
    prisma.stockOut.findMany({
      where: { invoice: { dealerId: { in: dealerIds } } },
      select: { productId: true, quantity: true, sellingPrice: true, invoice: { select: { dealerId: true } } },
    }),
    // ✅ Historical ab sirf type: IN — OUT concept hata diya gaya hai
    prisma.dealerHistoricalStock.findMany({
      where: { dealerId: { in: dealerIds }, type: 'IN' },
      select: { dealerId: true, productId: true, quantity: true, purchasePrice: true, mrp: true, serialNumbers: true },
    }),
  ])

  const financeMap = {}
  const ensureFinance = (id) => {
    if (!financeMap[id]) financeMap[id] = { stockQty: 0, saleQty: 0, stockValueMrp: 0, cogs: 0, saleRevenue: 0 }
    return financeMap[id]
  }

  // ✅ NEW — dealer+product level weighted-average cost tracking (COGS fix)
 const productCostMap = {}
const costKey = (dealerId, productId, productName) => productId ? `${dealerId}::pid:${productId}` : `${dealerId}::name:${productName}`
const ensureProductCost = (key) => {
  if (!productCostMap[key]) productCostMap[key] = { qty: 0, cost: 0 }
  return productCostMap[key]
}

for (const si of dealerStockIns) {
  if (si.sourceNote?.toUpperCase().includes('SALES RETURN')) continue
  const f = ensureFinance(si.dealerId)
  f.stockQty += si.quantity
  f.stockValueMrp += (si.mrp || 0) * si.quantity
  const pc = ensureProductCost(costKey(si.dealerId, si.productId, null))
  pc.qty += si.quantity
  pc.cost += si.purchasePrice * si.quantity
}
for (const h of dealerHistoricalIn) {
  const f = ensureFinance(h.dealerId)
  const origQty = h.serialNumbers?.length || h.quantity
  f.stockQty += origQty
  f.stockValueMrp += (h.mrp || 0) * origQty
  const pc = ensureProductCost(costKey(h.dealerId, h.productId, h.productName)) // ✅ productName pass
  pc.qty += origQty
  pc.cost += (h.purchasePrice || 0) * origQty
}
for (const so of dealerInvoiceStockOuts) {
  const dId = so.invoice.dealerId
  if (!dId) continue
  const f = ensureFinance(dId)
  f.saleQty += so.quantity
  f.saleRevenue += so.sellingPrice * so.quantity
  const pc = productCostMap[costKey(dId, so.productId, so.productName)] // ✅ productName fallback
  const avgCostPerUnit = pc && pc.qty > 0 ? pc.cost / pc.qty : 0
  f.cogs += avgCostPerUnit * so.quantity
}

  const dealersWithCount = dealers.map(d => {
    const fin = financeMap[d.id] || { stockQty: 0, saleQty: 0, stockValueMrp: 0, cogs: 0, saleRevenue: 0 }
    return {
      ...d,
      _count: {
        ...d._count,
        invoices: mainInvoiceMap[d.id] ?? 0,
        stockOuts: invoiceStockOutMap[d.id] ?? 0, // ✅ sirf invoice-based
      },
      stockIn: fin.stockQty,           // card: "Stock In"
      totalSale: fin.saleQty,          // card: "Sale" — invoice se
      stockValue: fin.stockValueMrp,   // card: "Stock Value" — MRP based
      allTimeProfit: Math.max(0, fin.saleRevenue - fin.cogs), // ✅ FIX: sirf sold units ka cost minus hota hai ab
    }
  })

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
        _count: { select: { stockIns: true, invoices: true } },
      },
    }),
    prisma.invoice.count({ where: { dealerId: id } }),
    prisma.stockOut.count({ where: { invoice: { dealerId: id } } }),
  ])
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  return {
    ...dealer,
    _count: {
      ...dealer._count,
      invoices: mainInvoiceCount,
      stockOuts: invoiceStockOutCount, // ✅ sirf invoice-based sale count
    },
  }
}

export const createDealer = async (data) => {
  const { branchId, ...rest } = data
  return prisma.dealer.create({
    data: { ...rest, ...(branchId && { branchId }) },
  })
}

export const updateDealer = async (id, data) => {
  const dealer = await prisma.dealer.findUnique({ where: { id } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const { branchId, ...rest } = data
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

  await prisma.$transaction(async (tx) => {
    // ── 1. STOCK IN records ──
    const stockIns = await tx.stockIn.findMany({
      where: { dealerId: id },
      select: { id: true, productId: true, branchId: true, quantity: true, sourceNote: true },
    })
    const stockInIds = stockIns.map(s => s.id)

    if (stockInIds.length) {
      await tx.serialNumber.deleteMany({ where: { stockInId: { in: stockInIds } } })
    }

    const stockDeltaMap = new Map()
    for (const si of stockIns) {
      const key = `${si.productId}::${si.branchId}`
      const isSalesReturn = si.sourceNote?.toUpperCase().includes('SALES RETURN')
      const delta = isSalesReturn ? -si.quantity : si.quantity
      stockDeltaMap.set(key, (stockDeltaMap.get(key) || 0) + delta)
    }

    for (const [key, delta] of stockDeltaMap.entries()) {
      const [productId, branchId] = key.split('::')
      if (delta === 0) continue
      const stockExists = await tx.productStock.findUnique({
        where: { productId_branchId: { productId, branchId } },
      })
      if (delta > 0) {
        await tx.productStock.upsert({
          where: { productId_branchId: { productId, branchId } },
          update: { currentStock: { increment: delta } },
          create: { productId, branchId, currentStock: delta },
        })
      } else if (stockExists) {
        await tx.productStock.update({
          where: { productId_branchId: { productId, branchId } },
          data: { currentStock: { decrement: -delta } },
        })
      }
    }

    await tx.stockIn.deleteMany({ where: { dealerId: id } })

    // ── 2. OLD DealerInvoice model ──
    await tx.dealerInvoice.deleteMany({ where: { dealerId: id } })

    // ── 3. MAIN Invoice model + StockOuts ──
    const invoices = await tx.invoice.findMany({
      where: { dealerId: id },
      select: { id: true, stockOuts: { select: { id: true, productId: true, branchId: true, quantity: true } } },
    })
    const invoiceIds = invoices.map(i => i.id)
    const allStockOuts = invoices.flatMap(i => i.stockOuts)
    const stockOutIds = allStockOuts.map(so => so.id)

    if (stockOutIds.length) {
      await tx.serialNumber.updateMany({
        where: { stockOutId: { in: stockOutIds } },
        data: { status: 'AVAILABLE', stockOutId: null },
      })
    }

    const soDeltaMap = new Map()
    for (const so of allStockOuts) {
      if (!so.productId) continue
      const key = `${so.productId}::${so.branchId}`
      soDeltaMap.set(key, (soDeltaMap.get(key) || 0) + so.quantity)
    }
    for (const [key, qty] of soDeltaMap.entries()) {
      const [productId, branchId] = key.split('::')
      const stockExists = await tx.productStock.findUnique({
        where: { productId_branchId: { productId, branchId } },
      })
      if (stockExists) {
        await tx.productStock.update({
          where: { productId_branchId: { productId, branchId } },
          data: { currentStock: { increment: qty } },
        })
      }
    }

    if (invoiceIds.length) {
      await tx.stockOut.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } })
    }

    // ── 4. Historical stock + serials ──
    const histRecords = await tx.dealerHistoricalStock.findMany({
      where: { dealerId: id },
      select: { id: true },
    })
    const histIds = histRecords.map(h => h.id)
    if (histIds.length) {
      await tx.serialNumber.deleteMany({ where: { historicalStockId: { in: histIds } } })
    }
    await tx.dealerHistoricalStock.deleteMany({ where: { dealerId: id } })

    // ── 5. Dealer khud ──
    await tx.dealer.delete({ where: { id } })
  }, { timeout: 60000, maxWait: 10000 })

  return { message: 'Dealer and all associated records deleted permanently.' }
}

// ─── DEALER STOCK IN (Give Stock to Dealer) ──────────────────────────────────
// Ye sirf STOCK TRANSFER hai — koi sale/revenue nahi banti yahan.

export const createDealerStockIn = async (dealerId, data, createdBy) => {
  const {
    productId, branchId, quantity, costPrice,
    dealerPurchasePrice, mrp, lowStockThreshold,
    serialNumberIds, referenceNo, date, notes,
  } = data

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
        dealerPurchasePrice: Number(dealerPurchasePrice) || 0,
        mrp: Number(mrp) || 0,
        lowStockThreshold: lowStockThreshold != null ? Number(lowStockThreshold) : 10,
        dealerId,
        origin: 'DEALER_SUPPLY',
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
  const histWhere = { dealerId, type: 'IN' }
  if (startDate || endDate) {
    where.date = {}
    histWhere.date = {}
    if (startDate) { where.date.gte = new Date(startDate); histWhere.date.gte = new Date(startDate) }
    if (endDate)   { where.date.lte = new Date(endDate);   histWhere.date.lte = new Date(endDate) }
  }

  const [realHistory, historicalIns, realTotal, histTotal] = await Promise.all([
    prisma.stockIn.findMany({
      where, include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        serialNumbers: { select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.dealerHistoricalStock.findMany({
      where: histWhere,
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.stockIn.count({ where }),
    prisma.dealerHistoricalStock.count({ where: histWhere }),
  ])

  const normalizedHistorical = historicalIns.map(h => ({
    id: h.id,
    isHistorical: true,
    quantity: h.serialNumbers?.length || h.quantity,
    purchasePrice: h.purchasePrice,
    dealerPurchasePrice: h.dealerPurchasePrice,
    mrp: h.mrp || 0,
    lowStockThreshold: h.lowStockThreshold,
    sourceNote: h.notes || 'Manually added (Add Past Stock)',
    referenceNo: null,
    date: h.date,
    product: h.product || { id: null, name: h.productName, sku: null },
    branch: null,
    serialNumbers: (h.serialNumbers || []).map(sn => ({ serialNumber: sn })),
  }))

  const combined = [...realHistory, ...normalizedHistorical]
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const skip = (Number(page) - 1) * Number(limit)
  const history = combined.slice(skip, skip + Number(limit))
  const total = realTotal + histTotal

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  // ✅ Sale ab sirf Invoice se
  const [allStockIns, allHistoricalIns, monthInvoiceStockOuts] = await Promise.all([
    prisma.stockIn.findMany({ where: { dealerId }, select: { quantity: true, mrp: true, sourceNote: true, date: true } }),
    prisma.dealerHistoricalStock.findMany({ where: { dealerId, type: 'IN' }, select: { quantity: true, mrp: true, serialNumbers: true, date: true } }),
    prisma.stockOut.findMany({ where: { invoice: { dealerId }, date: { gte: monthStart, lte: monthEnd } }, select: { quantity: true, sellingPrice: true } }),
  ])

  const realStockIns = allStockIns.filter(si => !si.sourceNote?.toUpperCase().includes('SALES RETURN'))

  const totalStockValue =
    realStockIns.reduce((sum, si) => sum + (si.mrp || 0) * si.quantity, 0) +
    allHistoricalIns.reduce((sum, h) => sum + (h.mrp || 0) * (h.serialNumbers?.length || h.quantity), 0)

  const totalSaleThisMonth = monthInvoiceStockOuts.reduce((sum, so) => sum + so.sellingPrice * so.quantity, 0)

  const unitsGivenThisMonth =
    realStockIns.filter(si => new Date(si.date) >= monthStart && new Date(si.date) <= monthEnd)
      .reduce((sum, si) => sum + si.quantity, 0) +
    allHistoricalIns.filter(h => new Date(h.date) >= monthStart && new Date(h.date) <= monthEnd)
      .reduce((sum, h) => sum + (h.serialNumbers?.length || h.quantity), 0)

  return {
    history,
    totalStockValue,
    totalSaleThisMonth,
    unitsGivenThisMonth,
    totalQuantity: combined.reduce((sum, s) => sum + (s.quantity || (s.serialNumbers?.length ?? 0)), 0),
    totalTransactions: total,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  }
}

// ─── DEALER STOCK SUMMARY ─────────────────────────────────────────────────────

export const getDealerStockSummary = async (dealerId) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  const yearStart  = new Date(now.getFullYear(), 0, 1)

  const [stockIns, historicalRecords, invoiceStockOuts, dealerInvoices] = await Promise.all([
    prisma.stockIn.findMany({
      where: { dealerId },
      include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
    }),
    // ✅ sirf type: IN
    prisma.dealerHistoricalStock.findMany({
      where: { dealerId, type: 'IN' },
      include: { product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } } },
    }),
    // ✅ Sale — sirf Invoice se
    prisma.stockOut.findMany({
      where: { invoice: { dealerId } },
      select: {
        productId: true, productName: true, quantity: true, sellingPrice: true, date: true,
        product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } },
      },
    }),
    prisma.invoice.findMany({ where: { dealerId }, select: { totalAmount: true } }),
  ])

  const map = new Map()
  const getKey = (productId, productName) => productId ? `pid:${productId}` : `name:${productName}`
  const ensureEntry = (key, product, productName) => {
    if (!map.has(key)) {
      map.set(key, {
        product: product || { id: null, name: productName, sku: null, hasSerialNumbers: false },
        given: 0, sold: 0, salesReturn: 0, soldInMonth: 0,
        historicalIn: 0,
        isHistoricalOnly: !product,
      })
    }
  }

  for (const si of stockIns) {
    const key = getKey(si.productId, si.product?.name)
    ensureEntry(key, si.product, si.product?.name)
    const entry = map.get(key)
    if (si.sourceNote?.toUpperCase().includes('SALES RETURN')) entry.salesReturn += si.quantity
    else entry.given += si.quantity
  }

  for (const h of historicalRecords) {
    const key = getKey(h.productId, h.productName)
    ensureEntry(key, h.product || null, h.productName)
    map.get(key).historicalIn += (h.serialNumbers?.length || h.quantity)
  }

  for (const so of invoiceStockOuts) {
    const productName = so.product?.name ?? so.productName
    const key = getKey(so.productId, productName)
    ensureEntry(key, so.product, productName)
    const entry = map.get(key)
    entry.sold += so.quantity
    if (so.date && new Date(so.date) >= monthStart && new Date(so.date) <= monthEnd) {
      entry.soldInMonth += so.quantity
    }
  }

  const summary = Array.from(map.values()).map((entry) => {
    const currentStock = (entry.given + entry.historicalIn) - entry.sold - entry.salesReturn
    const totalStock = entry.given + entry.historicalIn
    const percentSold = totalStock > 0 ? Math.round((entry.sold / totalStock) * 100) : 0

    return {
      ...entry,
      currentStock,
      totalStock,
      totalSoldQty: entry.sold,
      totalPending: currentStock,
      percentSold,
      percentPending: 100 - percentSold,
    }
  })

  const monthlySaleAmount = invoiceStockOuts
    .filter(so => so.date && new Date(so.date) >= monthStart && new Date(so.date) <= monthEnd)
    .reduce((sum, so) => sum + (so.sellingPrice || 0) * so.quantity, 0)

  const totalSaleThisYear = invoiceStockOuts
    .filter(so => so.date && new Date(so.date) >= yearStart)
    .reduce((s, so) => s + so.quantity, 0)

  const averageOrderValue = dealerInvoices.length
    ? dealerInvoices.reduce((s, i) => s + i.totalAmount, 0) / dealerInvoices.length
    : 0

  return { summary, monthlySaleAmount, totalSaleThisYear, averageOrderValue }
}

// ─── GET DEALER SERIALS ───────────────────────────────────────────────────────

export const getDealerSerials = async (dealerId, productId, branchId, productName) => {
  if (!productId) {
    if (!productName) return []

    const historicalStringRecords = await prisma.dealerHistoricalStock.findMany({
      where: { dealerId, productId: null, productName, type: 'IN', serialNumbers: { isEmpty: false } },
      select: { id: true, serialNumbers: true, usedSerialNumbers: true },
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

  const stockInWhere = { dealerId, productId }
  if (branchId) stockInWhere.branchId = branchId

  const stockIns = await prisma.stockIn.findMany({ where: stockInWhere, select: { id: true } })
  const stockInIds = stockIns.map(s => s.id)

  const [transferredSerials, historicalSerialRecords] = await Promise.all([
    stockInIds.length
      ? prisma.serialNumber.findMany({
          where: { stockInId: { in: stockInIds }, status: 'TRANSFERRED', productId },
          select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true, historicalStockId: true },
          orderBy: { serialNumber: 'asc' },
        })
      : [],
    prisma.serialNumber.findMany({
      where: { productId, status: 'DEALER_HISTORICAL', historicalStock: { dealerId } },
      select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true, historicalStockId: true },
      orderBy: { serialNumber: 'asc' },
    }),
  ])

  return [...transferredSerials, ...historicalSerialRecords]
}

// ─── GET DEALER UNBILLED STOCK (invoice generation ke liye) ─────────────────

export const getDealerUnbilledStock = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

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
        include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true, hasSerialNumbers: true } } },
        orderBy: { serialNumber: 'asc' },
      })
    : []

  const historicalLinkedSerials = await prisma.serialNumber.findMany({
    where: { status: 'DEALER_HISTORICAL', dealerBillingStatus: 'UNBILLED', historicalStock: { dealerId } },
    include: { product: { select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true, hasSerialNumbers: true } } },
    orderBy: { serialNumber: 'asc' },
  })

  // ✅ Manual/free-text products — ab sirf type: IN, balance = totalIn - usedSerialNumbers (serial wale)
  //    ya totalIn - invoice-consumed qty (non-serial wale — neeche note dekho)
  const manualHistoricals = await prisma.dealerHistoricalStock.findMany({
    where: { dealerId, productId: null, type: 'IN' },
    select: {
      id: true, productName: true, serialNumbers: true, usedSerialNumbers: true,
      purchasePrice: true, salePrice: true, quantity: true,
       usedQuantity: true, 
    },
  })

  const productMap = new Map()
  for (const serial of unbilledSerials) {
    const pid = serial.productId
    if (!productMap.has(pid)) {
      productMap.set(pid, {
        type: 'inventory', productId: pid, productName: serial.product.name, sku: serial.product.sku,
        sellingPrice: serial.product.sellingPrice, gstRate: serial.product.gstRate,
        hasSerialNumbers: serial.product.hasSerialNumbers, serials: [],
      })
    }
    productMap.get(pid).serials.push({ id: serial.id, serialNumber: serial.serialNumber, type: 'transferred' })
  }

  for (const serial of historicalLinkedSerials) {
    const pid = serial.productId
    const key = `hist_linked_${pid}`
    if (!productMap.has(key)) {
      productMap.set(key, {
        type: 'historical_linked', productId: pid, productName: serial.product.name, sku: serial.product.sku,
        sellingPrice: serial.product.sellingPrice, gstRate: serial.product.gstRate,
        hasSerialNumbers: true, serials: [],
      })
    }
    productMap.get(key).serials.push({
      id: serial.id, serialNumber: serial.serialNumber, type: 'dealer_historical', historicalStockId: serial.historicalStockId,
    })
  }

  const manualProductMap = new Map()
  for (const hist of manualHistoricals) {
    const pName = hist.productName
    if (!manualProductMap.has(pName)) {
      manualProductMap.set(pName, {
        type: 'manual', productId: null, productName: pName, sku: null,
        sellingPrice: hist.salePrice || 0, gstRate: 0, hasSerialNumbers: false,
        totalIn: 0, serials: [],
      })
    }
    const entry = manualProductMap.get(pName)
    entry.totalIn += hist.quantity
    entry.totalUsed = (entry.totalUsed || 0) + (hist.usedQuantity || 0) 

    const usedSet = new Set(hist.usedSerialNumbers || [])
    for (const sn of hist.serialNumbers) {
      if (!usedSet.has(sn)) {
        entry.serials.push({ id: `hist_${hist.id}_${sn}`, serialNumber: sn, type: 'manual' })
        entry.hasSerialNumbers = true
      }
    }
  }

  const inventoryProducts = Array.from(productMap.values()).map(p => ({ ...p, quantity: p.serials.length || 0 }))
  const manualProducts = Array.from(manualProductMap.values())
    .filter(p => (p.hasSerialNumbers ? p.serials.length > 0 : p.totalIn > 0))
    .map(p => {
      const { totalIn, ...rest } = p
      return { ...rest, quantity: p.hasSerialNumbers ? p.serials.length :  (p.totalIn - (p.totalUsed || 0))}
    })

  return { dealer, products: [...inventoryProducts, ...manualProducts] }
}

// ─── DEALER INVOICES (old DealerInvoice model — backward compat) ─────────────

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
    include: { dealer: { select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true } } },
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
    include: { dealer: { select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true } } },
  })
  if (!invoice) throw { statusCode: 404, message: 'Invoice not found.' }
  return invoice
}

// ─── MAIN INVOICES LINKED TO DEALER ───────────────────────────────────────────

export const getDealerMainInvoices = async (dealerId, { page = 1, limit = 20, startDate, endDate } = {}) => {
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
    prisma.invoice.findMany({
      where, skip, take: Number(limit),
      include: {
        stockOuts: {
          select: {
            id: true, quantity: true, sellingPrice: true, productName: true,
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

// ─── SALES RETURN (dealer se product wapas — StockIn origin SALES_RETURN) ────

export const createDealerSalesReturn = async (dealerId, data, createdBy) => {
  const { productId, branchId, quantity, serialNumberIds, notes, date } = data

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

  // ✅ Dealer balance — ab sirf Invoice-consumed quantity ghatani hai (DealerStockOut hata diya)
const [totalIn, returnedSoFar, invoiceOut, historicalIn] = await Promise.all([
  prisma.stockIn.aggregate({ where: { dealerId, productId, origin: 'DEALER_SUPPLY' }, _sum: { quantity: true } }),
  prisma.stockIn.aggregate({ where: { dealerId, productId, origin: 'SALES_RETURN' }, _sum: { quantity: true } }), // ✅ ADD
  prisma.stockOut.aggregate({ where: { invoice: { dealerId }, productId }, _sum: { quantity: true } }),
  prisma.dealerHistoricalStock.findMany({
    where: { dealerId, productId, type: 'IN' },
    select: { quantity: true, serialNumbers: true },
  }),
])
const historicalQty = historicalIn.reduce((s, h) => s + (h.serialNumbers?.length || h.quantity), 0)
const dealerBalance =
  (totalIn._sum.quantity || 0) -
  (returnedSoFar._sum.quantity || 0) +         
  historicalQty -
  (invoiceOut._sum.quantity || 0)


  if (Number(quantity) > dealerBalance)
    throw { statusCode: 400, message: `Dealer balance insufficient for return. Current balance: ${dealerBalance}` }

  const productStock = await prisma.productStock.findUnique({
    where: { productId_branchId: { productId, branchId } },
  })

  let stockInId
  await prisma.$transaction(async (tx) => {
    const stockIn = await tx.stockIn.create({
      data: {
        productId, branchId,
        quantity: Number(quantity),
        purchasePrice: 0,
        dealerId,
        sourceNote: `SALES RETURN: ${dealer.name}${notes ? ' — ' + notes : ''}`,
        origin: 'SALES_RETURN',
        date: date ? new Date(date) : new Date(),
        createdBy,
      },
    })
    stockInId = stockIn.id

    if (product.hasSerialNumbers && serialNumberIds?.length) {
      const dealerStockInIds = await tx.stockIn.findMany({ where: { dealerId, productId }, select: { id: true } })
      const validStockInIds = dealerStockInIds.map(s => s.id)

      const serials = await tx.serialNumber.findMany({
        where: { id: { in: serialNumberIds }, status: 'TRANSFERRED', stockInId: { in: validStockInIds } },
        select: { id: true },
      })
      if (serials.length !== serialNumberIds.length)
        throw { statusCode: 400, message: 'Some serial numbers are not valid / not with this dealer.' }

      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: {
          status: 'AVAILABLE', dealerBillingStatus: null, dealerInvoiceId: null, stockInId: stockIn.id,
        },
      })
    }

    if (productStock) {
      await tx.productStock.update({
        where: { productId_branchId: { productId, branchId } },
        data: { currentStock: { increment: Number(quantity) } },
      })
    } else {
      await tx.productStock.create({ data: { productId, branchId, currentStock: Number(quantity) } })
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

// ─── DEALERS OVERVIEW STATS ───────────────────────────────────────────────────

export const getDealersOverviewStats = async (branchId) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const dealerCond = { isActive: true, ...(branchId && { branchId }) }
  const stockInWhere = { dealerId: { not: null }, dealer: dealerCond }
  const invoiceStockOutWhere = { invoice: { dealerId: { not: null }, dealer: dealerCond } }

  const [allStockIns, allInvoiceStockOuts] = await Promise.all([
    prisma.stockIn.findMany({
      where: stockInWhere,
      select: { dealerId: true, productId: true, quantity: true, purchasePrice: true, sourceNote: true, date: true, lowStockThreshold: true },
    }),
    prisma.stockOut.findMany({
      where: invoiceStockOutWhere,
      select: { quantity: true, sellingPrice: true, productId: true, date: true, invoice: { select: { dealerId: true } } },
    }),
  ])

  // ✅ sirf type: IN
  const allHistorical = await prisma.dealerHistoricalStock.findMany({
    where: { dealer: dealerCond, type: 'IN' },
    select: { dealerId: true, productId: true, quantity: true, purchasePrice: true, date: true, lowStockThreshold: true, serialNumbers: true },
  })

  // ── Total Wholesale — SIRF Invoice se, all-time ──
  const totalWholesaleRevenue = allInvoiceStockOuts.reduce((sum, so) => sum + so.sellingPrice * so.quantity, 0)

  // ── Total Sale — is month ka Invoice revenue ──
  const inMonth = (d) => d && new Date(d) >= monthStart && new Date(d) <= monthEnd
  const totalSaleThisMonth = allInvoiceStockOuts
    .filter(so => inMonth(so.date))
    .reduce((sum, so) => sum + so.sellingPrice * so.quantity, 0)

  // ── All Profit — Invoice revenue - COGS (sirf sold units ka weighted-avg purchase price), clamp 0 ──
  const realStockInsAllTime = allStockIns.filter(si => !si.sourceNote?.toUpperCase().includes('SALES RETURN'))

  // ✅ NEW — dealer+product level weighted-average cost tracking (COGS fix)
  const productCostMap = new Map()
  const addCost = (dealerId, productId, qty, cost) => {
    if (!productId) return
    const key = `${dealerId}::${productId}`
    if (!productCostMap.has(key)) productCostMap.set(key, { qty: 0, cost: 0 })
    const pc = productCostMap.get(key)
    pc.qty += qty
    pc.cost += cost
  }
  for (const si of realStockInsAllTime) addCost(si.dealerId, si.productId, si.quantity, si.purchasePrice * si.quantity)
  for (const h of allHistorical) {
    const qty = h.serialNumbers?.length || h.quantity
    addCost(h.dealerId, h.productId, qty, (h.purchasePrice || 0) * qty)
  }

  // ✅ COGS — sirf becha gaya units ka weighted-avg cost
  let totalCOGS = 0
  for (const so of allInvoiceStockOuts) {
    const dId = so.invoice.dealerId
    if (!dId || !so.productId) continue
    const pc = productCostMap.get(`${dId}::${so.productId}`)
    const avgCostPerUnit = pc && pc.qty > 0 ? pc.cost / pc.qty : 0
    totalCOGS += avgCostPerUnit * so.quantity
  }

  const allProfit = Math.max(0, totalWholesaleRevenue - totalCOGS)

  // ── Products in hand / Low stock ──
  const balanceMap = new Map()
  const thresholdMap = new Map()

  const trackThreshold = (key, threshold, date) => {
    const existing = thresholdMap.get(key)
    if (!existing || new Date(date) >= existing.latestDate) {
      thresholdMap.set(key, { threshold: threshold ?? 10, latestDate: new Date(date) })
    }
  }

  for (const si of allStockIns) {
    const key = `${si.dealerId}::${si.productId}`
    if (!balanceMap.has(key)) balanceMap.set(key, { given: 0, sold: 0, returned: 0 })
    const entry = balanceMap.get(key)
    if (si.sourceNote?.toUpperCase().includes('SALES RETURN')) entry.returned += si.quantity
    else entry.given += si.quantity
    trackThreshold(key, si.lowStockThreshold, si.date)
  }
  for (const h of allHistorical) {
    if (!h.productId) continue
    const key = `${h.dealerId}::${h.productId}`
    if (!balanceMap.has(key)) balanceMap.set(key, { given: 0, sold: 0, returned: 0 })
    balanceMap.get(key).given += (h.serialNumbers?.length || h.quantity)
    trackThreshold(key, h.lowStockThreshold, h.date)
  }
  for (const so of allInvoiceStockOuts) {
    if (!so.productId) continue
    const key = `${so.invoice.dealerId}::${so.productId}`
    if (!balanceMap.has(key)) balanceMap.set(key, { given: 0, sold: 0, returned: 0 })
    balanceMap.get(key).sold += so.quantity
  }

  let productsInHand = 0
  let lowStockItems = 0
  for (const [key, entry] of balanceMap.entries()) {
    const balance = entry.given - entry.sold - entry.returned
    if (balance > 0) {
      productsInHand += balance
      const threshold = thresholdMap.get(key)?.threshold ?? 10
      if (balance <= threshold) lowStockItems++
    }
  }

  return { totalWholesaleRevenue, totalSaleThisMonth, allProfit, productsInHand, lowStockItems }
}

// ─── DEALER HISTORICAL STOCK (Add Past Stock) — ab SIRF type: IN allowed ─────

export const addDealerHistoricalStock = async (dealerId, data) => {
  const {
    productId, productName, serialNumbers, type, quantity,
    purchasePrice, dealerPurchasePrice, mrp, lowStockThreshold,
    date, notes,
  } = data

  // ✅ "Record Sale" concept hat gaya — Add Past Stock sirf IN allow karega
  if (type !== 'IN') {
    throw { statusCode: 400, message: 'Only stock-in (past supply) entries are allowed here. Record sales through Invoice.' }
  }

  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) throw { statusCode: 404, message: 'Product not found.' }
  }

  const branch = await prisma.branch.findFirst({
    where: productId ? { productStocks: { some: { productId } } } : {},
    select: { id: true },
  })
  const branchId = dealer.branchId || branch?.id

  const record = await prisma.$transaction(async (tx) => {
    const hist = await tx.dealerHistoricalStock.create({
      data: {
        dealerId,
        productId: productId || null,
        productName,
        serialNumbers: serialNumbers || [],
        type: 'IN',
        quantity: Number(quantity),
        purchasePrice: Number(purchasePrice) || 0,
        dealerPurchasePrice: Number(dealerPurchasePrice) || 0,
        mrp: Number(mrp) || 0,
        salePrice: 0,
        lowStockThreshold: lowStockThreshold != null ? Number(lowStockThreshold) : 10,
        date: date ? new Date(date) : new Date(),
        notes: notes || null,
      },
    })

    if (serialNumbers?.length && productId && branchId) {
      await tx.serialNumber.createMany({
        data: serialNumbers.map(sn => ({
          serialNumber: sn.trim().toUpperCase(),
          productId, branchId,
          status: 'DEALER_HISTORICAL',
          historicalStockId: hist.id,
          dealerBillingStatus: 'UNBILLED',
        })),
        skipDuplicates: true,
      })
    }

    return hist
  })

  return prisma.dealerHistoricalStock.findUnique({
    where: { id: record.id },
    include: {
      dealer: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, sku: true } },
      serialNumberRecords: { select: { id: true, serialNumber: true, status: true } },
    },
  })
}

export const getDealerHistoricalStock = async (dealerId, { page = 1, limit = 20 } = {}) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  // ✅ type filter hata diya — ab sirf IN records exist karenge
  const where = { dealerId, type: 'IN' }

  const skip = (Number(page) - 1) * Number(limit)
  const [records, total] = await Promise.all([
    prisma.dealerHistoricalStock.findMany({
      where, skip, take: Number(limit),
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.dealerHistoricalStock.count({ where }),
  ])

  return { records, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) } }
}

export const deleteDealerHistoricalStock = async (dealerId, recordId) => {
  const record = await prisma.dealerHistoricalStock.findFirst({ where: { id: recordId, dealerId } })
  if (!record) throw { statusCode: 404, message: 'Record not found.' }

  await prisma.dealerHistoricalStock.delete({ where: { id: recordId } })
}

// ─── GET DEALER ASSIGNED PRODUCTS (ALL — billed + unbilled) ──────────────────

export const getDealerAssignedProducts = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const stockIns = await prisma.stockIn.findMany({ where: { dealerId }, select: { id: true, productId: true } })
  const stockInIds = stockIns.map(s => s.id)
  const productIds = [...new Set(stockIns.map(s => s.productId))]

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true, sellingPrice: true, gstRate: true,mrp: true, hasSerialNumbers: true },
      })
    : []
  const productMap = Object.fromEntries(products.map(p => [p.id, p]))

  const allRealSerials = stockInIds.length
    ? await prisma.serialNumber.findMany({
        where: { stockInId: { in: stockInIds } },
        select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true, productId: true },
        orderBy: { serialNumber: 'asc' },
      })
    : []

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
      type: 'inventory', productId: pid, productName: p.name, sku: p.sku,
      sellingPrice: p.sellingPrice, gstRate: p.gstRate, mrp: p.mrp,hasSerialNumbers: p.hasSerialNumbers, serials: [],
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
      historicalStockId: s.historicalStockId, billed: s.status === 'SOLD' || s.dealerBillingStatus === 'BILLED',
    })
  }

  const manualRecords = await prisma.dealerHistoricalStock.findMany({
    where: { dealerId, productId: null, type: 'IN' },
    select: { id: true, productName: true, quantity: true, salePrice: true, serialNumbers: true, usedSerialNumbers: true },
  })

  const manualMap = new Map()
  for (const r of manualRecords) {
    if (!manualMap.has(r.productName)) {
      manualMap.set(r.productName, {
        type: 'manual', productId: null, productName: r.productName, sku: null,
        sellingPrice: r.salePrice || 0, gstRate: 0, hasSerialNumbers: false,
        serials: [], totalIn: 0,
      })
    }
    const entry = manualMap.get(r.productName)
    entry.totalIn += r.quantity
    const usedSet = new Set(r.usedSerialNumbers || [])
    for (const sn of r.serialNumbers || []) {
      entry.serials.push({ id: `hist_${r.id}_${sn}`, serialNumber: sn, type: 'manual', historicalStockId: r.id, billed: usedSet.has(sn) })
      entry.hasSerialNumbers = true
    }
  }

  
// ✅ NEW — non-serial real products ka balance calculate karo (given - invoiced)
const nonSerialProductIds = productIds.filter(pid => {
  const p = productMap[pid]
  return p && !p.hasSerialNumbers
})

let nonSerialBalanceMap = {}
if (nonSerialProductIds.length) {
  const [givenRows, invoicedRows, histRows] = await Promise.all([
    prisma.stockIn.findMany({
      where: { dealerId, productId: { in: nonSerialProductIds } },
      select: { productId: true, quantity: true, sourceNote: true },
    }),
    prisma.stockOut.findMany({
      where: { invoice: { dealerId }, productId: { in: nonSerialProductIds } },
      select: { productId: true, quantity: true },
    }),
    prisma.dealerHistoricalStock.findMany({
      where: { dealerId, productId: { in: nonSerialProductIds }, type: 'IN' },
      select: { productId: true, quantity: true, usedQuantity: true },
    }),
  ])

  for (const r of givenRows) {
    if (!nonSerialBalanceMap[r.productId]) nonSerialBalanceMap[r.productId] = 0
    const isReturn = r.sourceNote?.toUpperCase().includes('SALES RETURN')
    nonSerialBalanceMap[r.productId] += isReturn ? -r.quantity : r.quantity
  }
  for (const r of histRows) {
    if (!nonSerialBalanceMap[r.productId]) nonSerialBalanceMap[r.productId] = 0
    nonSerialBalanceMap[r.productId] += (r.quantity - (r.usedQuantity || 0))
  }
  for (const r of invoicedRows) {
    if (!nonSerialBalanceMap[r.productId]) nonSerialBalanceMap[r.productId] = 0
    nonSerialBalanceMap[r.productId] -= r.quantity
  }
}

const inventoryProducts = Array.from(inventoryMap.values()).map(p => ({
  ...p,
  quantity: p.hasSerialNumbers ? p.serials.length : Math.max(0, nonSerialBalanceMap[p.productId] || 0),
}))
  const manualProducts = Array.from(manualMap.values())
    .filter(p => p.totalIn > 0)
    .map(p => {
      const { totalIn, ...rest } = p
      return { ...rest, quantity: p.hasSerialNumbers ? p.serials.length : totalIn }
    })

  return { dealer, products: [...inventoryProducts, ...manualProducts] }
}

// ─── DEALER STOCK IN: UPDATE ──────────────────────────────────────────────────

export const updateDealerStockIn = async (dealerId, stockInId, data, user) => {
  const { productId, branchId, quantity, costPrice, dealerPurchasePrice, mrp, lowStockThreshold, serialNumberIds, notes, referenceNo, date } = data

  const existing = await prisma.stockIn.findFirst({
    where: { id: stockInId, dealerId },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-in record not found.' }

  const soldOrBilled = existing.serialNumbers.filter(s => s.status === 'SOLD' || s.dealerBillingStatus === 'BILLED')
  const unsoldSerials = existing.serialNumbers.filter(s => s.status === 'TRANSFERRED' && s.dealerBillingStatus !== 'BILLED')

  if (soldOrBilled.length > 0) {
    if (productId && productId !== existing.productId) {
      throw { statusCode: 400, message: `Cannot change product: ${soldOrBilled.length} serial number(s) already sold/billed.` }
    }
    if (branchId && branchId !== existing.branchId) {
      throw { statusCode: 400, message: `Cannot change branch: ${soldOrBilled.length} serial number(s) already sold/billed.` }
    }
  }

  const finalProductId = productId || existing.productId
  const finalBranchId  = branchId  || existing.branchId
  const product = await prisma.product.findUnique({ where: { id: finalProductId } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }

  const newQty = Number(quantity)
  if (newQty < soldOrBilled.length) {
    throw { statusCode: 400, message: `Quantity cannot be less than ${soldOrBilled.length} (already sold/billed units).` }
  }

  if (product.hasSerialNumbers) {
    if ((serialNumberIds || []).length !== newQty) {
      throw { statusCode: 400, message: `Serial numbers count (${(serialNumberIds || []).length}) must match quantity (${newQty}).` }
    }
    const soldIds = new Set(soldOrBilled.map(s => s.id))
    const missingSold = [...soldIds].filter(id => !(serialNumberIds || []).includes(id))
    if (missingSold.length > 0) {
      throw { statusCode: 400, message: 'Already sold/billed serial numbers cannot be removed from selection.' }
    }
  }

  const productChanged = productId && productId !== existing.productId
  const branchChanged  = branchId && branchId !== existing.branchId

  const result = await prisma.$transaction(async (tx) => {
    if (!productChanged && !branchChanged) {
      const oldQty = existing.quantity
      const qtyDiff = newQty - oldQty

      if (qtyDiff > 0) {
        const productStock = await tx.productStock.findUnique({
          where: { productId_branchId: { productId: finalProductId, branchId: finalBranchId } },
        })
        if (!productStock || productStock.currentStock < qtyDiff) {
          throw { statusCode: 400, message: `Insufficient branch stock. Available: ${productStock?.currentStock || 0}` }
        }
      }

      await tx.productStock.update({
        where: { productId_branchId: { productId: finalProductId, branchId: finalBranchId } },
        data: { currentStock: { decrement: qtyDiff } },
      })

      if (product.hasSerialNumbers && serialNumberIds?.length) {
        await tx.serialNumber.updateMany({
          where: { stockInId: stockInId, status: 'TRANSFERRED', dealerBillingStatus: { not: 'BILLED' } },
          data: { status: 'AVAILABLE', stockInId: null, dealerBillingStatus: null },
        })

        const toLink = serialNumberIds.filter(id => !soldOrBilled.some(s => s.id === id))
        if (toLink.length) {
          const avail = await tx.serialNumber.findMany({ where: { id: { in: toLink }, status: 'AVAILABLE', branchId: finalBranchId } })
          if (avail.length !== toLink.length) {
            throw { statusCode: 400, message: 'Some selected serial numbers are not available.' }
          }
          await tx.serialNumber.updateMany({
            where: { id: { in: toLink } },
            data: { status: 'TRANSFERRED', stockInId: stockInId, dealerBillingStatus: 'UNBILLED' },
          })
        }
      }

      return tx.stockIn.update({
        where: { id: stockInId },
        data: {
          quantity: newQty,
          purchasePrice: Number(costPrice),
          dealerPurchasePrice: dealerPurchasePrice != null ? Number(dealerPurchasePrice) : existing.dealerPurchasePrice,
          mrp: mrp != null ? Number(mrp) : existing.mrp,
          lowStockThreshold: lowStockThreshold != null ? Number(lowStockThreshold) : existing.lowStockThreshold,
          referenceNo,
          sourceNote: notes || existing.sourceNote,
          date: date ? new Date(date) : existing.date,
        },
      })
    }

    await tx.productStock.update({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
      data: { currentStock: { increment: existing.quantity } },
    })
    await tx.serialNumber.updateMany({
      where: { stockInId: stockInId },
      data: { status: 'AVAILABLE', stockInId: null, dealerBillingStatus: null },
    })

    const newProductStock = await tx.productStock.findUnique({
      where: { productId_branchId: { productId: finalProductId, branchId: finalBranchId } },
    })
    if (!newProductStock || newProductStock.currentStock < newQty) {
      throw { statusCode: 400, message: `Insufficient stock in selected branch. Available: ${newProductStock?.currentStock || 0}` }
    }
    await tx.productStock.update({
      where: { productId_branchId: { productId: finalProductId, branchId: finalBranchId } },
      data: { currentStock: { decrement: newQty } },
    })

    if (product.hasSerialNumbers && serialNumberIds?.length) {
      const avail = await tx.serialNumber.findMany({ where: { id: { in: serialNumberIds }, status: 'AVAILABLE', branchId: finalBranchId } })
      if (avail.length !== serialNumberIds.length) {
        throw { statusCode: 400, message: 'Some selected serial numbers are not available.' }
      }
      await tx.serialNumber.updateMany({
        where: { id: { in: serialNumberIds } },
        data: { status: 'TRANSFERRED', stockInId: stockInId, dealerBillingStatus: 'UNBILLED' },
      })
    }

    return tx.stockIn.update({
      where: { id: stockInId },
      data: {
        productId: finalProductId,
        branchId: finalBranchId,
        quantity: newQty,
        purchasePrice: Number(costPrice),
        dealerPurchasePrice: dealerPurchasePrice != null ? Number(dealerPurchasePrice) : existing.dealerPurchasePrice,
        mrp: mrp != null ? Number(mrp) : existing.mrp,
        lowStockThreshold: lowStockThreshold != null ? Number(lowStockThreshold) : existing.lowStockThreshold,
        referenceNo,
        sourceNote: notes || existing.sourceNote,
        date: date ? new Date(date) : existing.date,
      },
    })
  })

  return prisma.stockIn.findUnique({
    where: { id: result.id },
    include: {
      product: { select: { id: true, name: true, sku: true, hasSerialNumbers: true } },
      branch: { select: { id: true, name: true } },
      serialNumbers: { select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true } },
    },
  })
}

// ─── DEALER STOCK IN: DELETE ──────────────────────────────────────────────────

export const deleteDealerStockIn = async (dealerId, stockInId) => {
  const existing = await prisma.stockIn.findFirst({
    where: { id: stockInId, dealerId },
    include: { serialNumbers: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Stock-in record not found.' }

  const soldOrBilled = existing.serialNumbers.filter(s => s.status === 'SOLD' || s.dealerBillingStatus === 'BILLED')
  const unsoldSerials = existing.serialNumbers.filter(s => !(s.status === 'SOLD' || s.dealerBillingStatus === 'BILLED'))

  if (!existing.serialNumbers.length) {
    const productStock = await prisma.productStock.findUnique({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
    })
    if (!productStock || productStock.currentStock < existing.quantity) {
      throw {
        statusCode: 400,
        message: `Cannot delete: some of this stock may have already been sold to the dealer's customers. Available branch-side reversal: ${productStock?.currentStock || 0}, needed: ${existing.quantity}.`,
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.productStock.update({
        where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
        data: { currentStock: { increment: existing.quantity } },
      })
      await tx.stockIn.delete({ where: { id: stockInId } })
    })
    return { message: 'Stock-in record deleted and stock returned to branch.' }
  }

  if (unsoldSerials.length === 0) {
    throw { statusCode: 400, message: 'Cannot delete: all serial numbers from this record have already been sold/billed.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.serialNumber.deleteMany({ where: { id: { in: unsoldSerials.map(s => s.id) } } })

    await tx.productStock.update({
      where: { productId_branchId: { productId: existing.productId, branchId: existing.branchId } },
      data: { currentStock: { increment: unsoldSerials.length } },
    })

    if (soldOrBilled.length === 0) {
      await tx.stockIn.delete({ where: { id: stockInId } })
    } else {
      await tx.stockIn.update({ where: { id: stockInId }, data: { quantity: soldOrBilled.length } })
    }
  })

  return {
    message: soldOrBilled.length > 0
      ? `Removed ${unsoldSerials.length} unsold unit(s). ${soldOrBilled.length} already-sold unit(s) kept intact.`
      : 'Stock-in record deleted and stock returned to branch.',
  }
}

// ─── DEALER DETAIL PAGE — GRAPH ───────────────────────────────────────────────

export const getDealerGraphData = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const [stockIns, invoiceStockOuts, historical] = await Promise.all([
    prisma.stockIn.findMany({
      where: { dealerId },
      select: { productId: true, quantity: true, purchasePrice: true, mrp: true, sourceNote: true, date: true },
    }),
    prisma.stockOut.findMany({
      where: { invoice: { dealerId } },
      select: { productId: true, productName: true, quantity: true, sellingPrice: true, date: true }, // ✅ productName add kiya
    }),
    prisma.dealerHistoricalStock.findMany({
      where: { dealerId, type: 'IN' },
      select: { productId: true, productName: true, quantity: true, purchasePrice: true, date: true, mrp: true, serialNumbers: true }, // ✅ productName add kiya
    }),
  ])

  const realStockIns = stockIns.filter(si => !si.sourceNote?.toUpperCase().includes('SALES RETURN'))
  const allTimeSalesPrice = invoiceStockOuts.reduce((s, so) => s + so.sellingPrice * so.quantity, 0)

  // ✅ FIX — key productId ya productName dono se ban sakti hai
  const costKey = (productId, productName) => productId ? `pid:${productId}` : `name:${productName}`

  const productCostMap = new Map()
  const addCost = (key, qty, cost) => {
    if (!key) return
    if (!productCostMap.has(key)) productCostMap.set(key, { qty: 0, cost: 0 })
    const pc = productCostMap.get(key)
    pc.qty += qty
    pc.cost += cost
  }

  realStockIns.forEach(si => addCost(costKey(si.productId, null), si.quantity, si.purchasePrice * si.quantity))
  historical.forEach(h => addCost(
    costKey(h.productId, h.productName),
    h.serialNumbers?.length || h.quantity,
    (h.purchasePrice || 0) * (h.serialNumbers?.length || h.quantity)
  ))

  const allTimeCOGS = invoiceStockOuts.reduce((sum, so) => {
    const pc = productCostMap.get(costKey(so.productId, so.productName))
    const avgCostPerUnit = pc && pc.qty > 0 ? pc.cost / pc.qty : 0
    return sum + avgCostPerUnit * so.quantity
  }, 0)

  const allTimePurchasePrice = allTimeCOGS
  const allTimeProfit = Math.max(0, allTimeSalesPrice - allTimeCOGS)

  const stockValueMrp =
    realStockIns.reduce((s, si) => s + (si.mrp || 0) * si.quantity, 0) +
    historical.reduce((s, h) => s + (h.mrp || 0) * (h.serialNumbers?.length || h.quantity), 0)

  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const monthlySales = Array(12).fill(0)
  invoiceStockOuts.forEach(so => {
    const d = new Date(so.date)
    if (d >= yearStart) monthlySales[d.getMonth()] += so.sellingPrice * so.quantity
  })

  return { allTimePurchasePrice, allTimeSalesPrice, allTimeProfit, stockValueMrp, monthlySales, allTimeCOGS }
}

// ─── EXCEL EXPORT ──────────────────────────────────────────────────────────────

export const exportDealerStockReportExcel = async (dealerId, startDate, endDate) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const dateFilter = {}
  if (startDate) dateFilter.gte = new Date(startDate)
  if (endDate) dateFilter.lte = new Date(endDate)

  const [stockIns, invoiceStockOuts, historical] = await Promise.all([
    prisma.stockIn.findMany({
      where: { dealerId, ...(Object.keys(dateFilter).length && { date: dateFilter }) },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { date: 'asc' },
    }),
    // ✅ Sale — sirf Invoice se
    prisma.stockOut.findMany({
      where: { invoice: { dealerId }, ...(Object.keys(dateFilter).length && { date: dateFilter }) },
      select: { date: true, quantity: true, sellingPrice: true, productName: true, product: { select: { name: true } } },
      orderBy: { date: 'asc' },
    }),
    // ✅ sirf type: IN
    prisma.dealerHistoricalStock.findMany({
      where: { dealerId, type: 'IN', ...(Object.keys(dateFilter).length && { date: dateFilter }) },
      orderBy: { date: 'asc' },
    }),
  ])

  const workbook = new ExcelJS.Workbook()

  const sIn = workbook.addWorksheet('Stock Given')
  sIn.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Product', key: 'product', width: 25 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Company Purchase Price', key: 'purchasePrice', width: 20 },
    { header: 'Dealer Purchase Price', key: 'dealerPurchasePrice', width: 20 },
    { header: 'MRP', key: 'mrp', width: 12 },
  ]
  stockIns.forEach(si => sIn.addRow({
    date: si.date.toISOString().slice(0, 10),
    product: si.product?.name || '-',
    qty: si.quantity,
    purchasePrice: si.purchasePrice,
    dealerPurchasePrice: si.dealerPurchasePrice,
    mrp: si.mrp,
  }))

  const sOut = workbook.addWorksheet('Sales (Invoiced)')
  sOut.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Product', key: 'product', width: 25 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Sale Price', key: 'salePrice', width: 15 },
    { header: 'Total', key: 'total', width: 15 },
  ]
  invoiceStockOuts.forEach(so => sOut.addRow({
    date: so.date.toISOString().slice(0, 10),
    product: so.product?.name || so.productName || '-',
    qty: so.quantity,
    salePrice: so.sellingPrice,
    total: so.sellingPrice * so.quantity,
  }))

  const sHist = workbook.addWorksheet('Historical (Past Stock)')
  sHist.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Product', key: 'product', width: 25 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Purchase Price (Company)', key: 'purchasePrice', width: 22 },
    { header: 'Purchase Price (Dealer)', key: 'dealerPurchasePrice', width: 22 },
  ]
  historical.forEach(h => sHist.addRow({
    date: h.date.toISOString().slice(0, 10),
    product: h.productName,
    qty: h.quantity,
    purchasePrice: h.purchasePrice,
    dealerPurchasePrice: h.dealerPurchasePrice,
  }))

  return { workbook, dealerName: dealer.name }
}

// ─── SALES STATS (Dealer detail page ke "Sales" section ke liye) ────────────

export const getDealerSalesStats = async (dealerId) => {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
  if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const [monthInvoices, monthInvoiceStockOuts] = await Promise.all([
    prisma.invoice.findMany({ where: { dealerId, date: { gte: monthStart, lte: monthEnd } }, select: { totalAmount: true } }),
    prisma.stockOut.findMany({
      where: { invoice: { dealerId }, date: { gte: monthStart, lte: monthEnd } },
      select: { quantity: true, sellingPrice: true },
    }),
  ])

  const totalRevenueThisMonth = monthInvoiceStockOuts.reduce((sum, so) => sum + so.sellingPrice * so.quantity, 0)

  const averageOrderValueThisMonth = monthInvoices.length
    ? monthInvoices.reduce((s, i) => s + i.totalAmount, 0) / monthInvoices.length
    : 0

  const unitsSoldThisMonth = monthInvoiceStockOuts.reduce((s, so) => s + so.quantity, 0)

  return { totalRevenueThisMonth, averageOrderValueThisMonth, unitsSoldThisMonth }
}


export const updateDealerHistoricalStock = async (dealerId, recordId, data) => {
  const {
    productName, serialNumbers, quantity,
    purchasePrice, dealerPurchasePrice, mrp, lowStockThreshold,
    date, notes,
  } = data

  const existing = await prisma.dealerHistoricalStock.findFirst({
    where: { id: recordId, dealerId },
    include: { serialNumberRecords: true },
  })
  if (!existing) throw { statusCode: 404, message: 'Historical stock record not found.' }

  const hasSerials = (existing.serialNumbers?.length || 0) > 0
  const usedSet = new Set(existing.usedSerialNumbers || [])

  if (hasSerials) {
    const newSerials = (serialNumbers || []).map(s => s.trim().toUpperCase())

    // ✅ Already-used (invoice se consume ho chuke) serials remove nahi ho sakte
    const missingUsed = [...usedSet].filter(sn => !newSerials.includes(sn))
    if (missingUsed.length > 0) {
      throw { statusCode: 400, message: `Already billed/used serial number(s) cannot be removed: ${missingUsed.join(', ')}` }
    }

    const oldSerials = existing.serialNumbers || []
    const toRemove = oldSerials.filter(sn => !newSerials.includes(sn) && !usedSet.has(sn))
    const toAdd = newSerials.filter(sn => !oldSerials.includes(sn))

    await prisma.$transaction(async (tx) => {
      if (toRemove.length) {
        await tx.serialNumber.deleteMany({
          where: { historicalStockId: recordId, serialNumber: { in: toRemove } },
        })
      }
      if (toAdd.length && existing.productId) {
        const branchId = existing.serialNumberRecords[0]?.branchId
        if (branchId) {
          await tx.serialNumber.createMany({
            data: toAdd.map(sn => ({
              serialNumber: sn, productId: existing.productId, branchId,
              status: 'DEALER_HISTORICAL', historicalStockId: recordId, dealerBillingStatus: 'UNBILLED',
            })),
            skipDuplicates: true,
          })
        }
      }
      await tx.dealerHistoricalStock.update({
        where: { id: recordId },
        data: {
          productName: productName ?? existing.productName,
          serialNumbers: newSerials,
          quantity: newSerials.length,
          purchasePrice: purchasePrice != null ? Number(purchasePrice) : existing.purchasePrice,
          dealerPurchasePrice: dealerPurchasePrice != null ? Number(dealerPurchasePrice) : existing.dealerPurchasePrice,
          mrp: mrp != null ? Number(mrp) : existing.mrp,
          lowStockThreshold: lowStockThreshold != null ? Number(lowStockThreshold) : existing.lowStockThreshold,
          date: date ? new Date(date) : existing.date,
          notes: notes !== undefined ? notes : existing.notes,
        },
      })
    })
  } else {
    // ✅ Non-serial — quantity usedQuantity se kam nahi ho sakti
    const newQty = quantity != null ? Number(quantity) : existing.quantity
    if (newQty < (existing.usedQuantity || 0)) {
      throw { statusCode: 400, message: `Quantity cannot be less than ${existing.usedQuantity} (already used/invoiced units).` }
    }
    await prisma.dealerHistoricalStock.update({
      where: { id: recordId },
      data: {
        productName: productName ?? existing.productName,
        quantity: newQty,
        purchasePrice: purchasePrice != null ? Number(purchasePrice) : existing.purchasePrice,
        dealerPurchasePrice: dealerPurchasePrice != null ? Number(dealerPurchasePrice) : existing.dealerPurchasePrice,
        mrp: mrp != null ? Number(mrp) : existing.mrp,
        lowStockThreshold: lowStockThreshold != null ? Number(lowStockThreshold) : existing.lowStockThreshold,
        date: date ? new Date(date) : existing.date,
        notes: notes !== undefined ? notes : existing.notes,
      },
    })
  }

  return prisma.dealerHistoricalStock.findUnique({
    where: { id: recordId },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      serialNumberRecords: { select: { id: true, serialNumber: true, status: true, dealerBillingStatus: true } },
    },
  })
}