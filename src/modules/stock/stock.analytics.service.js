import prisma from '../../config/db.js'

// ─── Helper: branch filter based on role ─────────────────────────────────────
const branchWhere = (user, branchId) => {
  if (user.role === 'SUPER_ADMIN') return branchId ? { branchId } : {}
  return { branchId: user.branchId }
}

// ─── Monthly Revenue (last N months) ─────────────────────────────────────────
export const getMonthlyRevenue = async (user, { months = 6, branchId } = {}) => {
  const where = { ...branchWhere(user, branchId), invoiceId: { not: null } } // ✅ FIX

  const records = await prisma.stockOut.findMany({
    where: {
      ...where,
      date: { gte: new Date(new Date().setMonth(new Date().getMonth() - months + 1, 1)) },
    },
    select: { invoiceId: true },
  })

  const invoiceIds = [...new Set(records.map(r => r.invoiceId))]
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { totalAmount: true, date: true } })
    : []

  // Group by YYYY-MM using invoice.date
  const map = new Map()
  for (const inv of invoices) {
    const d = new Date(inv.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const prev = map.get(key) || { revenue: 0, count: 0 }
    prev.revenue += inv.totalAmount
    prev.count += 1
    map.set(key, prev)
  }

  // Fill all months (including empty ones)
  const result = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    const val = map.get(key) || { revenue: 0, count: 0 }
    result.push({ key, label, revenue: val.revenue, transactions: val.count })
  }

  return result
}

// ─── Yearly Revenue (last N years) ───────────────────────────────────────────
export const getYearlyRevenue = async (user, { years = 3, branchId } = {}) => {
  const where = { ...branchWhere(user, branchId), invoiceId: { not: null } } // ✅ FIX

  const records = await prisma.stockOut.findMany({
    where: {
      ...where,
      date: { gte: new Date(new Date().getFullYear() - years + 1, 0, 1) },
    },
    select: { invoiceId: true },
  })

  const invoiceIds = [...new Set(records.map(r => r.invoiceId))]
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { totalAmount: true, date: true } })
    : []

  const map = new Map()
  for (const inv of invoices) {
    const d = new Date(inv.date)
    // Financial year: Apr–Mar  e.g. "25-26"
    const fy = d.getMonth() >= 3
      ? `${String(d.getFullYear()).slice(2)}-${String(d.getFullYear() + 1).slice(2)}`
      : `${String(d.getFullYear() - 1).slice(2)}-${String(d.getFullYear()).slice(2)}`
    const prev = map.get(fy) || { revenue: 0, count: 0 }
    prev.revenue += inv.totalAmount
    prev.count += 1
    map.set(fy, prev)
  }

  return Array.from(map.entries())
    .map(([fy, val]) => ({ label: fy, revenue: val.revenue, transactions: val.count }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// ─── Breakdown: top products + top branches (treemap data) ───────────────────
// ─── Breakdown: top products + top branches (treemap data) ───────────────────
export const getBreakdown = async (user, { branchId, startDate, endDate } = {}) => {
  const where = {
    ...branchWhere(user, branchId),
    invoiceId: { not: null },   // ✅ FIX
    ...(startDate || endDate
      ? { date: { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) } }
      : {}),
  }

  const records = await prisma.stockOut.findMany({
    where,
    select: {
      quantity: true,
      sellingPrice: true,
      branchId: true,
      productId: true,
      productName: true,   // ✅ manual/free-text products ka naam yahan hota hai (productId null hone par)
      product: { select: { name: true } },
      branch: { select: { name: true } },
    },
  })

  // Group by product
  const productMap = new Map()
  const branchMap = new Map()

  for (const r of records) {
    const rev = r.sellingPrice * r.quantity

    // ✅ manual/free-text item (productId null) ke liye productName se naam + unique key dono lo,
    // taaki (a) "null" naam na dikhe, aur (b) alag-alag manual products
    // apni-apni alag row mein group hon (pehle sab productId=null ki ek hi key mein mix ho jaate the)
    const displayName = r.product?.name ?? r.productName ?? 'Unknown product'
    const pk = r.productId ?? `manual:${displayName}`
    const pp = productMap.get(pk) || { name: displayName, revenue: 0, transactions: 0 }
    productMap.set(pk, { ...pp, revenue: pp.revenue + rev, transactions: pp.transactions + 1 })

    // branch
    const bk = r.branchId
    const bp = branchMap.get(bk) || { name: r.branch?.name || bk, revenue: 0, transactions: 0 }
    branchMap.set(bk, { ...bp, revenue: bp.revenue + rev, transactions: bp.transactions + 1 })
  }

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)

  const topBranches = Array.from(branchMap.values())
    .sort((a, b) => b.revenue - a.revenue)

  return { topProducts, topBranches }
}

// ─── Summary stats ────────────────────────────────────────────────────────────
export const getSummary = async (user, { branchId, startDate, endDate } = {}) => {
  const where = {
    ...branchWhere(user, branchId),
    invoiceId: { not: null },   // ✅ FIX
    ...(startDate || endDate
      ? { date: { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) } }
      : {}),
  }

  const records = await prisma.stockOut.findMany({
    where,
    select: { quantity: true, invoiceId: true },
  })

  const invoiceIds = [...new Set(records.map(r => r.invoiceId))]
  const invoices = invoiceIds.length
    ? await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { totalAmount: true } })
    : []

  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  const totalTransactions = invoiceIds.length
  const totalUnits = records.reduce((s, r) => s + r.quantity, 0)
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0

  return { totalRevenue, totalTransactions, totalUnits, avgOrderValue }
}