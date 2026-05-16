// ─── expenses.service.js — updated with permission-aware queries ─────────────
// Backend mein Module enum mein EXPENSES add karna zaroori hai:
//
//   enum Module {
//     ...existing...
//     EXPENSES   // ← add this
//   }
//
// Phir `npx prisma migrate dev --name add_expenses_module` run karo.
//
// Yeh service file unchanged hai — permission check middleware level pe hoti hai.
// Neeche dekho expenses.routes.js update.

import prisma from '../../config/db.js'
import { startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns'

const parseDateRange = (startDate, endDate) => ({
  gte: startDate ? new Date(startDate) : undefined,
  lte: endDate ? new Date(endDate) : undefined,
})

const currentMonthRange = () => {
  const now = new Date()
  return { gte: startOfMonth(now), lte: endOfMonth(now) }
}

export const createExpense = async (data, user) => {
  if (!data.amount || isNaN(data.amount) || Number(data.amount) <= 0) {
    throw { statusCode: 400, message: 'Amount is required and must be a positive number.' }
  }
  return prisma.expense.create({
    data: {
      title: data.title || null,
      amount: Number(data.amount),
      category: data.category || null,
      paymentMethod: data.paymentMethod || 'CASH',
      notes: data.notes || null,
      date: data.date ? new Date(data.date) : new Date(),
      branchId: user.branchId || null,
      createdBy: user.id,
    },
  })
}

export const getExpenses = async (query, user) => {
  const { startDate, endDate, category, paymentMethod, page = 1, limit = 50 } = query
  const where = {
    branchId: user.role === 'SUPER_ADMIN' ? undefined : (user.branchId || undefined),
    date: startDate || endDate ? parseDateRange(startDate, endDate) : currentMonthRange(),
    ...(category && { category }),
    ...(paymentMethod && { paymentMethod }),
  }
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      include: { createdByUser: { select: { id: true, name: true } } },
    }),
    prisma.expense.count({ where }),
  ])
  return { expenses, total, page: Number(page), limit: Number(limit) }
}

export const updateExpense = async (id, data, user) => {
  const expense = await prisma.expense.findUnique({ where: { id } })
  if (!expense) throw { statusCode: 404, message: 'Expense not found.' }
  if (user.role !== 'SUPER_ADMIN' && expense.createdBy !== user.id)
    throw { statusCode: 403, message: 'Access denied.' }
  if (data.amount !== undefined && (isNaN(data.amount) || Number(data.amount) <= 0))
    throw { statusCode: 400, message: 'Amount must be a positive number.' }
  return prisma.expense.update({
    where: { id },
    data: {
      title: data.title ?? expense.title,
      amount: data.amount !== undefined ? Number(data.amount) : expense.amount,
      category: data.category ?? expense.category,
      paymentMethod: data.paymentMethod ?? expense.paymentMethod,
      notes: data.notes ?? expense.notes,
      date: data.date ? new Date(data.date) : expense.date,
    },
  })
}

export const deleteExpense = async (id, user) => {
  const expense = await prisma.expense.findUnique({ where: { id } })
  if (!expense) throw { statusCode: 404, message: 'Expense not found.' }
  if (user.role !== 'SUPER_ADMIN' && expense.createdBy !== user.id)
    throw { statusCode: 403, message: 'Access denied.' }
  await prisma.expense.delete({ where: { id } })
}

export const getExpenseStats = async (query, user) => {
  const { month, year, startDate, endDate } = query
  let dateFilter
  if (startDate || endDate) {
    dateFilter = parseDateRange(startDate, endDate)
  } else if (month && year) {
    const d = new Date(Number(year), Number(month) - 1, 1)
    dateFilter = { gte: startOfMonth(d), lte: endOfMonth(d) }
  } else {
    dateFilter = currentMonthRange()
  }

  const where = {
    branchId: user.role === 'SUPER_ADMIN' ? undefined : (user.branchId || undefined),
    date: dateFilter,
  }

  const expenses = await prisma.expense.findMany({
    where,
    select: { amount: true, category: true, paymentMethod: true, date: true },
  })

  if (expenses.length === 0) {
    return { total: 0, count: 0, todayTotal: 0, averageDaily: 0, highestDay: null, categoryBreakdown: [], paymentMethodBreakdown: [], dailyBreakdown: [] }
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const todayStart = startOfDay(new Date())
  const todayEnd = endOfDay(new Date())
  const todayTotal = expenses.filter(e => e.date >= todayStart && e.date <= todayEnd).reduce((sum, e) => sum + e.amount, 0)

  const dailyMap = {}
  for (const e of expenses) {
    const key = e.date.toISOString().split('T')[0]
    dailyMap[key] = (dailyMap[key] || 0) + e.amount
  }
  const dailyBreakdown = Object.entries(dailyMap).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date))
  const uniqueDays = dailyBreakdown.length
  const averageDaily = uniqueDays > 0 ? total / uniqueDays : 0
  const highestDay = dailyBreakdown.reduce((max, d) => (d.amount > (max?.amount || 0) ? d : max), null)

  const categoryMap = {}
  for (const e of expenses) {
    const key = e.category || 'Uncategorized'
    categoryMap[key] = (categoryMap[key] || 0) + e.amount
  }
  const categoryBreakdown = Object.entries(categoryMap).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)

  const pmMap = {}
  for (const e of expenses) { pmMap[e.paymentMethod] = (pmMap[e.paymentMethod] || 0) + e.amount }
  const paymentMethodBreakdown = Object.entries(pmMap).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount)

  return {
    total: Math.round(total * 100) / 100,
    count: expenses.length,
    todayTotal: Math.round(todayTotal * 100) / 100,
    averageDaily: Math.round(averageDaily * 100) / 100,
    highestDay,
    categoryBreakdown,
    paymentMethodBreakdown,
    dailyBreakdown,
  }
}