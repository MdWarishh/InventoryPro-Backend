import prisma from '../config/db.js'

export const generateInvoiceNumber = async (branchId) => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const settings = await prisma.settings.findUnique({ where: { branchId } })
  const prefix = settings?.invoicePrefix || 'INV'
  const shouldReset = settings?.resetInvoiceMonthly ?? true

  const counterKey = shouldReset
    ? { branchId, month, year }
    : { branchId, month: 0, year: 0 }

  const counter = await prisma.invoiceCounter.upsert({
    where: { branchId_month_year: counterKey },
    update: { lastNumber: { increment: 1 } },
    create: { ...counterKey, lastNumber: 1 },
  })

  const paddedNumber = counter.lastNumber.toString().padStart(3, '0')
  const monthStr = month.toString().padStart(2, '0')

  return shouldReset
    ? `${prefix}-${year}${monthStr}-${paddedNumber}`
    : `${prefix}-${paddedNumber}`
}

export const resetInvoiceCounter = async (branchId) => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  await prisma.invoiceCounter.deleteMany({
    where: { branchId, month, year }
  })

  return { message: 'Invoice counter reset successfully' }
}

export const previewInvoiceNumber = async (branchId) => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const settings = await prisma.settings.findUnique({ where: { branchId } })
  const prefix = settings?.invoicePrefix || 'INV'
  const shouldReset = settings?.resetInvoiceMonthly ?? true

  const counterKey = shouldReset
    ? { branchId, month, year }
    : { branchId, month: 0, year: 0 }

  // ⚠️ findUnique only — counter ko touch/increment NAHI karta
  const counter = await prisma.invoiceCounter.findUnique({ where: { branchId_month_year: counterKey } })
  const nextNumber = (counter?.lastNumber ?? 0) + 1

  const paddedNumber = nextNumber.toString().padStart(3, '0')
  const monthStr = month.toString().padStart(2, '0')

  return shouldReset
    ? `${prefix}-${year}${monthStr}-${paddedNumber}`
    : `${prefix}-${paddedNumber}`
}