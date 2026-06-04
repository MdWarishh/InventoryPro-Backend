import prisma from '../../config/db.js'

// ─── Helper: branch filter based on role ─────────────────────────────────────
const branchWhere = (user, branchId) => {
  if (user.role === 'SUPER_ADMIN') return branchId ? { branchId } : {}
  return { branchId: user.branchId }
}

// ─── Monthly Revenue (last N months) ─────────────────────────────────────────
export const getMonthlyRevenue = async (user, { months = 6, branchId } = {}) => {
  const where = branchWhere(user, branchId)

  const records = await prisma.stockOut.findMany({
    where: {
      ...where,
      date: {
        gte: new Date(new Date().setMonth(new Date().getMonth() - months + 1, 1)),
      },
    },
    select: { date: true, quantity: true, sellingPrice: true },
  })

  // Group by YYYY-MM
  const map = new Map()
  for (const r of records) {
    const d = new Date(r.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const prev = map.get(key) || { revenue: 0, transactions: 0 }
    map.set(key, {
      revenue: prev.revenue + r.sellingPrice * r.quantity,
      transactions: prev.transactions + 1,
    })
  }

  // Fill all months (including empty ones)
  const result = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    const val = map.get(key) || { revenue: 0, transactions: 0 }
    result.push({ key, label, revenue: val.revenue, transactions: val.transactions })
  }

  return result
}

// ─── Yearly Revenue (last N years) ───────────────────────────────────────────
export const getYearlyRevenue = async (user, { years = 3, branchId } = {}) => {
  const where = branchWhere(user, branchId)

  const records = await prisma.stockOut.findMany({
    where: {
      ...where,
      date: {
        gte: new Date(new Date().getFullYear() - years + 1, 0, 1),
      },
    },
    select: { date: true, quantity: true, sellingPrice: true },
  })

  const map = new Map()
  for (const r of records) {
    const year = new Date(r.date).getFullYear()
    // Financial year: Apr–Mar  e.g. "25-26"
    const d = new Date(r.date)
    const fy = d.getMonth() >= 3
      ? `${String(d.getFullYear()).slice(2)}-${String(d.getFullYear() + 1).slice(2)}`
      : `${String(d.getFullYear() - 1).slice(2)}-${String(d.getFullYear()).slice(2)}`
    const prev = map.get(fy) || { revenue: 0, transactions: 0 }
    map.set(fy, {
      revenue: prev.revenue + r.sellingPrice * r.quantity,
      transactions: prev.transactions + 1,
    })
  }

  return Array.from(map.entries())
    .map(([fy, val]) => ({ label: fy, revenue: val.revenue, transactions: val.transactions }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// ─── Breakdown: top products + top branches (treemap data) ───────────────────
export const getBreakdown = async (user, { branchId, startDate, endDate } = {}) => {
  const where = {
    ...branchWhere(user, branchId),
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  }

  const records = await prisma.stockOut.findMany({
    where,
    select: {
      quantity: true,
      sellingPrice: true,
      branchId: true,
      productId: true,
      product: { select: { name: true } },
      branch: { select: { name: true } },
    },
  })

  // Group by product
  const productMap = new Map()
  const branchMap = new Map()

  for (const r of records) {
    const rev = r.sellingPrice * r.quantity

    // product
    const pk = r.productId
    const pp = productMap.get(pk) || { name: r.product?.name || pk, revenue: 0, transactions: 0 }
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
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  }

  const records = await prisma.stockOut.findMany({
    where,
    select: { quantity: true, sellingPrice: true },
  })

  const totalRevenue = records.reduce((s, r) => s + r.sellingPrice * r.quantity, 0)
  const totalTransactions = records.length
  const totalUnits = records.reduce((s, r) => s + r.quantity, 0)
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0

  return { totalRevenue, totalTransactions, totalUnits, avgOrderValue }
}