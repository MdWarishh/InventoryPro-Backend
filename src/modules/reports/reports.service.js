import prisma from '../../config/db.js'
import { generateExcelReport } from '../../utils/excelParser.js'

const getBranchFilter = (user, branchId) => {
  const resolvedBranchId = typeof branchId === 'object' && branchId !== null
    ? branchId.branchId
    : branchId

  if (user.role === 'SUPER_ADMIN') return resolvedBranchId ? { branchId: resolvedBranchId } : {}

  const userBranchId = typeof user.branchId === 'object' && user.branchId !== null
    ? user.branchId.branchId
    : user.branchId

  return userBranchId ? { branchId: userBranchId } : {}
}

// ✅ NEW — DealerHistoricalStock ke liye branch filter (branchId directly nahi hai, dealer.branchId se)
const getDealerHistFilter = (user, branchId) => {
  const bf = getBranchFilter(user, branchId)
  return bf.branchId ? { dealer: { branchId: bf.branchId } } : {}
}

export const getDashboardStats = async (user, branchId) => {
  const filter = getBranchFilter(user, branchId)
  const today = new Date()
  const startOfToday = new Date(today.setHours(0, 0, 0, 0))
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [
    totalStockValue,
    lowStockCount,
    todaySales,
    monthSales,
    totalProducts,
    recentStockIns,
    recentStockOuts,
    allStockOuts,
    totalExpenseAgg,      // ✅ NEW — Expense model se
    monthExpenseAgg,      // ✅ NEW — Expense model se
    productStocksForMrp,  // ✅ NEW — MRP-based stock value ke liye
    mrpStockIns,          // ✅ NEW — MRP-based stock value ke liye
  ] = await Promise.all([
    prisma.productStock.aggregate({ where: filter, _sum: { currentStock: true } }),
    prisma.productStock.findMany({
      where: filter,
      include: { product: { select: { minStockAlert: true } } },
    }).then(stocks => stocks.filter(s => s.currentStock <= s.product.minStockAlert).length),
    prisma.stockOut.findMany({ where: { ...filter, date: { gte: startOfToday } }, select: { sellingPrice: true, quantity: true } }),
    prisma.stockOut.findMany({ where: { ...filter, date: { gte: startOfMonth } }, select: { sellingPrice: true, quantity: true } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.stockIn.findMany({
      where: filter,
      take: 5,
      orderBy: { date: 'desc' },
      include: { product: { select: { name: true, sku: true } }, branch: { select: { name: true } } },
    }),
    prisma.stockOut.findMany({
      where: filter,
      take: 5,
      orderBy: { date: 'desc' },
      include: {
        product: { select: { name: true, sku: true } },
        branch: { select: { name: true } },
      },
    }),
    prisma.stockOut.findMany({ where: filter, select: { sellingPrice: true, quantity: true } }),
    // ✅ NEW — total Expense (all-time), branch-filtered
    prisma.expense.aggregate({
      where: filter.branchId ? { branchId: filter.branchId } : {},
      _sum: { amount: true },
    }),
    // ✅ NEW — total Expense (this month), branch-filtered
    prisma.expense.aggregate({
      where: {
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        date: { gte: startOfMonth },
      },
      _sum: { amount: true },
    }),
    // ✅ NEW — current stock per product-branch, MRP value ke liye
    prisma.productStock.findMany({ where: filter, select: { productId: true, branchId: true, currentStock: true } }),
    // ✅ NEW — latest StockIn (origin: PURCHASE) ka mrp, per product-branch
    prisma.stockIn.findMany({
      where: { ...filter, origin: 'PURCHASE' },
      select: { productId: true, branchId: true, mrp: true, date: true },
      orderBy: { date: 'desc' },
    }),
  ])

  const todaySalesAmount = todaySales.reduce((sum, s) => sum + s.sellingPrice * s.quantity, 0)
  const monthSalesAmount = monthSales.reduce((sum, s) => sum + s.sellingPrice * s.quantity, 0)

  const totalRevenue = allStockOuts.reduce((sum, s) => sum + s.sellingPrice * s.quantity, 0)

  // ✅ NEW PROFIT FORMULA — saari invoice sales price − Expense model ka total
  const totalExpense = totalExpenseAgg._sum.amount || 0
  const monthExpense  = monthExpenseAgg._sum.amount || 0
  const totalProfit = totalRevenue - totalExpense
  const monthProfit  = monthSalesAmount - monthExpense

  // ✅ NEW — Total Stock Value, regular branch StockIn (origin: PURCHASE) ke latest mrp se
  const mrpMap = new Map()
  for (const si of mrpStockIns) {
    const key = `${si.productId}::${si.branchId}`
    if (!mrpMap.has(key)) mrpMap.set(key, si.mrp || 0)  // date desc sorted hai, pehla hi latest
  }
  const totalStockValueMrp = productStocksForMrp.reduce((sum, ps) => {
    const key = `${ps.productId}::${ps.branchId}`
    const mrp = mrpMap.get(key) || 0
    return sum + mrp * ps.currentStock
  }, 0)

  return {
    totalStock: totalStockValue._sum.currentStock || 0,
    lowStockCount,
    todaySales: { amount: todaySalesAmount, count: todaySales.length },
    monthSales: { amount: monthSalesAmount, count: monthSales.length },
    totalProducts,
    recentStockIns,
    recentStockOuts,
    totalRevenue,
    totalExpense,
    totalProfit,
    monthExpense,
    monthProfit,
    totalStockValueMrp,   // ✅ NEW — dashboard "Total Stock Value" card ke liye
  }
}

export const getSalesReport = async (user, { branchId, startDate, endDate, groupBy = 'day' } = {}) => {
  const filter = getBranchFilter(user, branchId)
  const dateFilter = {}
  if (startDate) dateFilter.gte = new Date(startDate)
  if (endDate) dateFilter.lte = new Date(endDate)
  if (Object.keys(dateFilter).length) filter.date = dateFilter

  const sales = await prisma.stockOut.findMany({
    where: filter,
    include: {
      product: { select: { id: true, name: true, sku: true, category: { select: { name: true } } } },
      branch: { select: { id: true, name: true } },
      invoice: { select: { invoiceNumber: true } },
    },
    orderBy: { date: 'desc' },
  })

  const totalRevenue = sales.reduce((sum, s) => sum + s.sellingPrice * s.quantity, 0)
  const totalQuantity = sales.reduce((sum, s) => sum + s.quantity, 0)

  const grouped = {}
  for (const sale of sales) {
    const key = groupBy === 'month'
      ? `${sale.date.getFullYear()}-${String(sale.date.getMonth() + 1).padStart(2, '0')}`
      : sale.date.toISOString().split('T')[0]
    if (!grouped[key]) grouped[key] = { date: key, revenue: 0, quantity: 0, count: 0 }
    grouped[key].revenue += sale.sellingPrice * sale.quantity
    grouped[key].quantity += sale.quantity
    grouped[key].count++
  }

  return {
    summary: { totalRevenue, totalQuantity, totalTransactions: sales.length },
    chart: Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date)),
    items: sales,
  }
}

export const getPurchaseReport = async (user, { branchId, startDate, endDate } = {}) => {
  const filter = getBranchFilter(user, { ...(branchId && { branchId }), origin: 'PURCHASE' }) // ✅ FIX — origin filter
  filter.origin = 'PURCHASE' // ✅ explicit (getBranchFilter na uda de isliye direct bhi set kar diya)
  const histFilter = getDealerHistFilter(user, branchId)

  if (startDate || endDate) {
    filter.date = {}
    if (startDate) filter.date.gte = new Date(startDate)
    if (endDate) filter.date.lte = new Date(endDate)
  }

  const histDateFilter = { ...histFilter, type: 'IN' }
  if (startDate || endDate) {
    histDateFilter.date = {}
    if (startDate) histDateFilter.date.gte = new Date(startDate)
    if (endDate) histDateFilter.date.lte = new Date(endDate)
  }

  const [purchases, historicalIn] = await Promise.all([
    prisma.stockIn.findMany({
      where: filter,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        branch: { select: { id: true, name: true } },
        dealer: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    }),
    // ✅ NEW — backdated/manual dealer purchase entries bhi purchase report mein
    prisma.dealerHistoricalStock.findMany({
      where: histDateFilter,
      include: {
        product: { select: { id: true, name: true, sku: true } },
        dealer: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
      },
      orderBy: { date: 'desc' },
    }),
  ])

  // ✅ Historical ko StockIn jaisi shape mein normalize karo taaki downloadReport/UI same rahe
  const normalizedHistorical = historicalIn.map(h => ({
    id: h.id,
    isHistorical: true,
    quantity: h.serialNumbers?.length || h.quantity,
    purchasePrice: h.purchasePrice,
    referenceNo: null,
    date: h.date,
    product: h.product || { id: null, name: h.productName, sku: '—' },
    branch: h.dealer?.branch || { id: null, name: 'Dealer (Historical)' },
    dealer: h.dealer,
  }))

  const combined = [...purchases, ...normalizedHistorical].sort((a, b) => new Date(b.date) - new Date(a.date))

  const totalPurchase = combined.reduce((sum, p) => sum + p.purchasePrice * p.quantity, 0)
  return { summary: { totalPurchase, totalTransactions: combined.length }, items: combined }
}

export const getStockValuationReport = async (user, branchId) => {
  // ✅ Unaffected — ye purely ProductStock (branch physical stock) pe based hai, dealer se koi lena-dena nahi
  const filter = getBranchFilter(user, branchId)

  const stocks = await prisma.productStock.findMany({
    where: { ...filter, currentStock: { gt: 0 } },
    include: {
      product: { include: { category: { select: { name: true } } } },
      branch: { select: { name: true } },
    },
  })

  const items = stocks
    .filter(s => s.product && s.product.isActive)
    .map(s => ({
      productName: s.product.name,
      sku: s.product.sku,
      category: s.product.category?.name || 'Uncategorized',
      branch: s.branch.name,
      currentStock: s.currentStock,
      purchasePrice: s.product.purchasePrice,
      sellingPrice: s.product.sellingPrice,
      purchaseValue: s.currentStock * s.product.purchasePrice,
      sellingValue: s.currentStock * s.product.sellingPrice,
    }))

  const totalPurchaseValue = items.reduce((sum, i) => sum + i.purchaseValue, 0)
  const totalSellingValue = items.reduce((sum, i) => sum + i.sellingValue, 0)

  return { summary: { totalPurchaseValue, totalSellingValue, potentialProfit: totalSellingValue - totalPurchaseValue }, items }
}

export const getAllBranchesReport = async (user, { startDate, endDate } = {}) => {
  if (user.role !== 'SUPER_ADMIN') throw { statusCode: 403, message: 'Access denied.' }

  const dateFilter = {}
  if (startDate || endDate) {
    dateFilter.date = {}
    if (startDate) dateFilter.date.gte = new Date(startDate)
    if (endDate) dateFilter.date.lte = new Date(endDate)
  }

  const branches = await prisma.branch.findMany({ where: { isActive: true } })

  const branchReports = await Promise.all(
    branches.map(async (branch) => {
      // ✅ FIX — aggregate hataya, findMany + reduce (quantity × price sahi calculate karne ke liye)
      const [salesRows, purchaseRows, historicalIn, stockData] = await Promise.all([
        prisma.stockOut.findMany({ where: { branchId: branch.id, ...dateFilter }, select: { sellingPrice: true, quantity: true } }),
        prisma.stockIn.findMany({ where: { branchId: branch.id, origin: 'PURCHASE', ...dateFilter }, select: { purchasePrice: true, quantity: true } }), // ✅ origin filter
        prisma.dealerHistoricalStock.findMany({
          where: { type: 'IN', dealer: { branchId: branch.id }, ...dateFilter },
          select: { purchasePrice: true, quantity: true, serialNumbers: true },
        }),
        prisma.productStock.aggregate({ where: { branchId: branch.id }, _sum: { currentStock: true } }),
      ])

      const revenue = salesRows.reduce((sum, s) => sum + s.sellingPrice * s.quantity, 0)
      const purchase =
        purchaseRows.reduce((sum, p) => sum + p.purchasePrice * p.quantity, 0) +
        historicalIn.reduce((sum, h) => sum + (h.purchasePrice || 0) * (h.serialNumbers?.length || h.quantity), 0)

      return {
        branchId: branch.id,
        branchName: branch.name,
        isMainBranch: branch.isMainBranch,
        totalSales: revenue,
        totalSalesCount: salesRows.length,
        totalPurchase: purchase,
        totalPurchaseCount: purchaseRows.length + historicalIn.length,
        currentStock: stockData._sum.currentStock || 0,
        grossProfit: revenue - purchase,
      }
    })
  )

  const totals = branchReports.reduce((acc, b) => ({
    totalSales: acc.totalSales + b.totalSales,
    totalPurchase: acc.totalPurchase + b.totalPurchase,
    totalStock: acc.totalStock + b.currentStock,
    grossProfit: acc.grossProfit + b.grossProfit,
  }), { totalSales: 0, totalPurchase: 0, totalStock: 0, grossProfit: 0 })

  return { branches: branchReports, totals }
}

// ✅ GST report — origin: PURCHASE filter add kiya (dealer-supply/return GST claim mein nahi aana chahiye,
//    kyunki wo real supplier se GST-invoiced purchase nahi hai — internal stock movement hai)
export const getGSTReport = async (user, { branchId, month, year, type = 'summary' } = {}) => {
  const filter = getBranchFilter(user, branchId)

  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)
  filter.date = { gte: startDate, lte: endDate }

  const purchaseFilter = { ...filter, origin: 'PURCHASE' } // ✅ FIX

  if (type === 'gstr1') {
    const sales = await prisma.stockOut.findMany({
      where: filter,
      include: {
        product: { select: { name: true, sku: true, gstRate: true, hsnCode: true, sellingPrice: true } },
        branch: { select: { name: true } },
        invoice: { select: { invoiceNumber: true, customerGST: true, customerName: true } },
      },
      orderBy: { date: 'asc' },
    })

    return sales
  .filter(s => s.product) // ✅ null product wale skip
  .map(s => ({
    invoiceNumber: s.invoice?.invoiceNumber || 'N/A',
    invoiceDate: s.date,
    customerName: s.invoice?.customerName || s.customerName || 'Consumer',
    customerGST: s.invoice?.customerGST || 'N/A',
    hsnCode: s.product.hsnCode || 'N/A',
    productName: s.product.name,
    quantity: s.quantity,
    taxableValue: s.sellingPrice * s.quantity,
    gstRate: s.product.gstRate,
    cgst: (s.sellingPrice * s.quantity * s.product.gstRate) / 200,
    sgst: (s.sellingPrice * s.quantity * s.product.gstRate) / 200,
    igst: 0,
    totalTax: (s.sellingPrice * s.quantity * s.product.gstRate) / 100,
    invoiceValue: s.sellingPrice * s.quantity * (1 + s.product.gstRate / 100),
  }))
  }

  if (type === 'gstr2') {
    const purchases = await prisma.stockIn.findMany({
      where: purchaseFilter, // ✅ FIX
      include: {
        product: { select: { name: true, sku: true, gstRate: true, hsnCode: true } },
        branch: { select: { name: true } },
        dealer: { select: { name: true, gstNumber: true } },
      },
      orderBy: { date: 'asc' },
    })

  return purchases
  .filter(p => p.product) // ✅ null product wale skip
  .map(p => ({
    date: p.date,
    dealerName: p.dealer?.name || 'Unknown',
    dealerGST: p.dealer?.gstNumber || 'N/A',
    hsnCode: p.product.hsnCode || 'N/A',
    productName: p.product.name,
    quantity: p.quantity,
    taxableValue: p.purchasePrice * p.quantity,
    gstRate: p.product.gstRate,
    cgst: (p.purchasePrice * p.quantity * p.product.gstRate) / 200,
    sgst: (p.purchasePrice * p.quantity * p.product.gstRate) / 200,
    igst: 0,
    totalTax: (p.purchasePrice * p.quantity * p.product.gstRate) / 100,
  }))
  }

  const [salesData, purchaseData] = await Promise.all([
    prisma.stockOut.findMany({ where: filter, include: { product: { select: { gstRate: true } } } }),
    prisma.stockIn.findMany({ where: purchaseFilter, include: { product: { select: { gstRate: true } } } }), // ✅ FIX
  ])

 const salesByRate = {}
for (const s of salesData) {
  if (!s.product) continue // ✅ null product skip
  const rate = s.product.gstRate
  const taxable = s.sellingPrice * s.quantity
  if (!salesByRate[rate]) salesByRate[rate] = { rate, taxableValue: 0, cgst: 0, sgst: 0, totalTax: 0 }
  salesByRate[rate].taxableValue += taxable
  salesByRate[rate].cgst += (taxable * rate) / 200
  salesByRate[rate].sgst += (taxable * rate) / 200
  salesByRate[rate].totalTax += (taxable * rate) / 100
}

const totalOutputTax = salesData.reduce((sum, s) => s.product ? sum + (s.sellingPrice * s.quantity * s.product.gstRate) / 100 : sum, 0)
const totalInputTax = purchaseData.reduce((sum, p) => p.product ? sum + (p.purchasePrice * p.quantity * p.product.gstRate) / 100 : sum, 0)

  return {
    month, year,
    outputTax: totalOutputTax,
    inputTax: totalInputTax,
    netPayable: totalOutputTax - totalInputTax,
    byRate: Object.values(salesByRate),
  }
}

export const getLowStockReport = async (user, branchId) => {
  // ✅ Unaffected — branch physical stock (ProductStock) based hai, sahi hai as-is
  const filter = getBranchFilter(user, branchId)
  const stocks = await prisma.productStock.findMany({
    where: filter,
    include: {
      product: { include: { category: { select: { name: true } } } },
      branch: { select: { name: true } },
    },
  })

  return stocks
    .filter(s => s.product && s.product.isActive && s.currentStock <= s.product.minStockAlert)
    .map(s => ({
      productId: s.product.id,
      productName: s.product.name,
      sku: s.product.sku,
      category: s.product.category?.name || 'Uncategorized',
      branch: s.branch.name,
      currentStock: s.currentStock,
      minStockAlert: s.product.minStockAlert,
      shortage: s.product.minStockAlert - s.currentStock,
    }))
    .sort((a, b) => a.currentStock - b.currentStock)
}

export const downloadReport = async (user, reportType, filters) => {
  let data = []
  let headers = []

  if (reportType === 'sales') {
    const result = await getSalesReport(user, filters)
    data = result.items.map(s => ({
      Date: s.date.toLocaleDateString(),
      Product: s.product.name,
      SKU: s.product.sku,
      Category: s.product.category?.name || '',
      Branch: s.branch.name,
      Quantity: s.quantity,
      'Selling Price': s.sellingPrice,
      'Total Amount': s.sellingPrice * s.quantity,
      Customer: s.customerName || '',
      'Customer Phone': s.customerPhone || '',
    }))
    headers = ['Date', 'Product', 'SKU', 'Category', 'Branch', 'Quantity', 'Selling Price', 'Total Amount', 'Customer', 'Customer Phone']
  } else if (reportType === 'purchase') {
    const result = await getPurchaseReport(user, filters)
    data = result.items.map(p => ({
      Date: p.date.toLocaleDateString(),
      Product: p.product?.name || '-',
      SKU: p.product?.sku || '-',
      Branch: p.branch?.name || '-',
      Quantity: p.quantity,
      'Purchase Price': p.purchasePrice,
      'Total Amount': p.purchasePrice * p.quantity,
      Dealer: p.dealer?.name || '',
      'Reference No': p.referenceNo || '',
      Source: p.isHistorical ? 'Historical (Manual)' : 'Regular', // ✅ NEW — batane ke liye ye row kaha se aayi
    }))
    headers = ['Date', 'Product', 'SKU', 'Branch', 'Quantity', 'Purchase Price', 'Total Amount', 'Dealer', 'Reference No', 'Source']
  } else if (reportType === 'stock-valuation') {
    const result = await getStockValuationReport(user, filters.branchId)
    data = result.items
    headers = ['productName', 'sku', 'category', 'branch', 'currentStock', 'purchasePrice', 'sellingPrice', 'purchaseValue', 'sellingValue']
  } else if (reportType === 'low-stock') {
    data = await getLowStockReport(user, filters.branchId)
    headers = ['productName', 'sku', 'category', 'branch', 'currentStock', 'minStockAlert', 'shortage']
  } else if (reportType === 'gst') {
    const result = await getGSTReport(user, filters)
    data = Array.isArray(result) ? result : [result]
    headers = Object.keys(data[0] || {})
  }

  return generateExcelReport(data, headers, reportType)
}