import prisma from '../../config/db.js'
import { generateInvoiceNumber, resetInvoiceCounter } from '../../utils/generateInvoiceNo.js'

export const createInvoice = async (data, user) => {
  const {
    branchId, customerName, customerPhone, customerEmail,
    customerAddress, customerGST, items, discount = 0, notes, terms, date,
    paymentMode = 'Cash',
    dealerId = null,
    isDealerInvoice = false,
    invoiceNumber: customInvoiceNumber,
  } = data

  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied to this branch.' }
  }

  if (dealerId) {
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
    if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
  }

  const branchSettings = await prisma.settings.findUnique({ where: { branchId } })
  const customModes = branchSettings?.customPaymentModes ?? []
  if (customModes.length > 0 && !customModes.includes(paymentMode)) {
    throw { statusCode: 400, message: `Payment mode "${paymentMode}" is not configured for this branch.` }
  }

   // Counter hamesha increment hoga (race-safe), taaki agli baar sahi next-number preview mile
// Counter hamesha ek hi baar increment hoga (race-safe), taaki agli baar sahi next-number preview mile
const generatedNumber = await generateInvoiceNumber(branchId)

let invoiceNumber = generatedNumber
if (customInvoiceNumber?.trim() && customInvoiceNumber.trim() !== generatedNumber) {
  const dup = await prisma.invoice.findFirst({
    where: { invoiceNumber: customInvoiceNumber.trim(), branchId },
  })
  if (dup) throw { statusCode: 400, message: `Invoice number "${customInvoiceNumber}" already exists.` }
  invoiceNumber = customInvoiceNumber.trim()
}

  let subtotal = 0
  let gstAmount = 0
  const processedItems = []

  for (const item of items) {
    // Manual/historical free-text products ka productId null hoga
    // Unke liye product lookup skip karo
    if (!item.productId) {
      // Manual product — no DB lookup needed
       const itemTotal = item.sellingPrice * item.quantity
  const effectiveGstRate = (item.gstRate !== undefined && item.gstRate !== null)
    ? Number(item.gstRate)
    : 0    

  const itemGST = itemTotal * (effectiveGstRate / 100)
  subtotal += itemTotal
  gstAmount += itemGST
  processedItems.push({ ...item, product: null, gstRate: effectiveGstRate })
  continue
}

   const product = await prisma.product.findUnique({ where: { id: item.productId } })
if (!product) throw { statusCode: 404, message: `Product not found: ${item.productId}` }

const itemTotal = item.sellingPrice * item.quantity
const effectiveGstRate = (item.gstRate !== undefined && item.gstRate !== null)
  ? Number(item.gstRate)
  : product.gstRate
const itemGST = itemTotal * (effectiveGstRate / 100)
subtotal += itemTotal
gstAmount += itemGST
processedItems.push({ ...item, product, gstRate: effectiveGstRate })
  }

  const totalAmount = subtotal + gstAmount - Number(discount)

  const invoice = await prisma.$transaction(async (tx) => {
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
        ...(dealerId && { dealerId }),
      },
    }) 

    await processInvoiceItems(tx, {
      inv, processedItems, dealerId, branchId,
      customerName, customerPhone, customerEmail, customerAddress,
      notes, date, user,
    })

    return inv
  },{ timeout: 30000, maxWait: 10000 })

  return getInvoiceById(invoice.id, user)
}

// ────────────────────────────────────────────────────────────────────────────
// Shared item-processing logic — used by BOTH createInvoice and updateInvoice
// so that editing an invoice supports exactly the same things creating it does
// (manual/free-text products, dealer historical stock, dealer transferred
// serials, normal branch stock + serials).
// ────────────────────────────────────────────────────────────────────────────
async function processInvoiceItems(tx, ctx) {
  const { inv, processedItems, dealerId, branchId, customerName, customerPhone, customerEmail, customerAddress, notes, date, user } = ctx

  for (const item of processedItems) {

    // ── DEALER INVOICE PATH ────────────────────────────────────────────────
    if (dealerId) {

      const allSerialIds = item.serialNumberIds || []

      const transferredIds = []
      const historicalIds  = []
      const manualEntries  = [] // { histId, sn }

      for (const sid of allSerialIds) {
        if (sid.startsWith('hist_')) {
          const parts = sid.split('_')
          const histId = parts[1]
          const sn = parts.slice(2).join('_')
          manualEntries.push({ histId, sn })
        } else {
          transferredIds.push(sid)
        }
      }

      if (transferredIds.length) {
        const realSerials = await tx.serialNumber.findMany({
          where: { id: { in: transferredIds } },
          select: { id: true, status: true },
        })
        for (const s of realSerials) {
          if (s.status === 'DEALER_HISTORICAL') {
            historicalIds.push(s.id)
            const idx = transferredIds.indexOf(s.id)
            if (idx !== -1) transferredIds.splice(idx, 1)
          }
        }
      }

      // ── 1. TRANSFERRED serials ──────────────────────────────────────────
      if (transferredIds.length) {
        const serials = await tx.serialNumber.findMany({
          where: {
            id: { in: transferredIds },
            status: 'TRANSFERRED',
            OR: [
              { dealerBillingStatus: 'UNBILLED' },
              { dealerBillingStatus: null },
            ],
          },
        })

        if (serials.length !== transferredIds.length) {
          throw {
            statusCode: 400,
            message: `Some serial numbers for "${item.product?.name || item.productName}" are already billed or not available.`,
          }
        }

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

        await tx.serialNumber.updateMany({
          where: { id: { in: transferredIds } },
          data: {
            status: 'SOLD',
            dealerBillingStatus: 'BILLED',
            dealerInvoiceId: inv.id,
          },
        })
      }

      // ── 2. DEALER_HISTORICAL serials ────────────────────────────────────
      if (historicalIds.length) {
        const historicalSerials = await tx.serialNumber.findMany({
          where: {
            id: { in: historicalIds },
            status: 'DEALER_HISTORICAL',
          },
          select: { id: true, serialNumber: true, historicalStockId: true, dealerBillingStatus: true },
        })

        if (historicalSerials.length !== historicalIds.length) {
          throw { statusCode: 400, message: `Some historical serial numbers are not available.` }
        }

        const alreadyBilled = historicalSerials.filter(s => s.dealerBillingStatus === 'BILLED')
        if (alreadyBilled.length) {
          throw { statusCode: 400, message: `Some historical serial numbers are already billed.` }
        }

        await tx.serialNumber.updateMany({
          where: { id: { in: historicalIds } },
          data: {
            status: 'SOLD',
            dealerBillingStatus: 'BILLED',
            dealerInvoiceId: inv.id,
          },
        })

        const grouped = {}
        for (const s of historicalSerials) {
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

      // ── 3. Manual free-text serials (hist_ prefix) ──────────────────────
      if (manualEntries.length) {
        const groupedManual = {}
        for (const { histId, sn } of manualEntries) {
          if (!groupedManual[histId]) groupedManual[histId] = []
          groupedManual[histId].push(sn)
        }

        for (const [histId, sns] of Object.entries(groupedManual)) {
          const sourceHist = await tx.dealerHistoricalStock.findFirst({
            where: { id: histId, dealerId },
            select: { id: true, serialNumbers: true, usedSerialNumbers: true, quantity: true },
          })
          if (!sourceHist) throw { statusCode: 400, message: 'Historical record not found.' }

          const usedSet = new Set(sourceHist.usedSerialNumbers || [])
          for (const sn of sns) {
            if (!sourceHist.serialNumbers.includes(sn))
              throw { statusCode: 400, message: `Serial ${sn} not found in historical record.` }
            if (usedSet.has(sn))
              throw { statusCode: 400, message: `Serial ${sn} already billed/used.` }
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

      // ── 4. Manual product WITHOUT serials — historical quantity deduct ──
      if (!item.productId && allSerialIds.length === 0) {
        const histRecords = await tx.dealerHistoricalStock.findMany({
          where: {
            dealerId,
            productId: null,
            productName: item.productName,
            type: 'IN',
            quantity: { gt: 0 },
          },
          orderBy: { date: 'asc' },
        })

        let remaining = Number(item.quantity)
        for (const hist of histRecords) {
          if (remaining <= 0) break
          const deduct = Math.min(hist.quantity, remaining)
          await tx.dealerHistoricalStock.update({
            where: { id: hist.id },
            data: { quantity: { decrement: deduct } },
          })
          remaining -= deduct
        }

        if (remaining > 0) {
          throw { statusCode: 400, message: `Insufficient historical stock for "${item.productName}".` }
        }
      }

      // ── StockOut record create ──────────────────────────────────────────
      await tx.stockOut.create({
        data: {
          productId: item.productId || null,
          productName: item.productId ? null : item.productName,
          branchId,
          quantity: Number(item.quantity),
          sellingPrice: Number(item.sellingPrice),
          gstRate: item.gstRate,
          customerName, customerPhone, customerEmail, customerAddress,
          invoiceId: inv.id,
          notes,
          date: date ? new Date(date) : new Date(),
          createdBy: user.id,
          manualSerialNumbers: manualEntries.map(e => e.sn),  
        },
      })

      // NOTE: productStock NOT decremented — already done at dealer StockIn time

    } else {
      // ── NORMAL INVOICE PATH ─────────────────────────────────────────────
      if (!item.productId) {
    await tx.stockOut.create({
      data: {
        productId: null,
        productName: item.productName,
        branchId,
        quantity: Number(item.quantity),
        sellingPrice: Number(item.sellingPrice),
        gstRate: item.gstRate,
        customerName, customerPhone, customerEmail, customerAddress,
        invoiceId: inv.id,
        notes,
        date: date ? new Date(date) : new Date(),
        createdBy: user.id,
      },
    })
    continue
  }

  const stockOutData = {
    productId: item.productId,
    branchId,
    quantity: Number(item.quantity),
    sellingPrice: Number(item.sellingPrice),
    gstRate: item.gstRate,
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
    throw { statusCode: 400, message: `Insufficient stock for: ${item.product?.name}` }
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
}

// ────────────────────────────────────────────────────────────────────────────
// Reverses everything an invoice's items did — inverse of processInvoiceItems.
// Called at the start of updateInvoice (and reusable by deleteInvoice) so that
// editing an invoice releases stock/serials exactly the same way deleting it
// would, before the new items are applied.
// ────────────────────────────────────────────────────────────────────────────
async function reverseInvoiceItems(tx, existing) {
  const isDealerInvoice = !!existing.dealerId

  if (isDealerInvoice) {
    // Real SerialNumber records linked to this invoice (TRANSFERRED-origin or DEALER_HISTORICAL-origin)
    const dealerSerials = await tx.serialNumber.findMany({
      where: { dealerInvoiceId: existing.id },
      select: { id: true, serialNumber: true, historicalStockId: true },
    })

    const transferredOrigin = dealerSerials.filter(s => !s.historicalStockId)
    const historicalOrigin  = dealerSerials.filter(s => !!s.historicalStockId)

    if (transferredOrigin.length) {
      await tx.serialNumber.updateMany({
        where: { id: { in: transferredOrigin.map(s => s.id) } },
        data: { status: 'TRANSFERRED', dealerBillingStatus: 'UNBILLED', dealerInvoiceId: null },
      })
    }

    if (historicalOrigin.length) {
      await tx.serialNumber.updateMany({
        where: { id: { in: historicalOrigin.map(s => s.id) } },
        data: { status: 'DEALER_HISTORICAL', dealerBillingStatus: 'UNBILLED', dealerInvoiceId: null },
      })

      const grouped = {}
      for (const s of historicalOrigin) {
        if (!grouped[s.historicalStockId]) grouped[s.historicalStockId] = []
        grouped[s.historicalStockId].push(s.serialNumber)
      }
      for (const [histId, sns] of Object.entries(grouped)) {
        const hist = await tx.dealerHistoricalStock.findUnique({
          where: { id: histId },
          select: { usedSerialNumbers: true },
        })
        const remaining = (hist?.usedSerialNumbers || []).filter(sn => !sns.includes(sn))
        await tx.dealerHistoricalStock.update({
          where: { id: histId },
          data: { quantity: { increment: sns.length }, usedSerialNumbers: { set: remaining } },
        })
      }
    }
// Manual hist_ serials reverse karo — ab StockOut.manualSerialNumbers se track ho sakta hai
const stockOutsWithManual = await tx.stockOut.findMany({
  where: { invoiceId: existing.id, manualSerialNumbers: { isEmpty: false } },
  select: { id: true, productName: true, manualSerialNumbers: true },
})
for (const so of stockOutsWithManual) {
  const sourceHist = await tx.dealerHistoricalStock.findFirst({
    where: { dealerId: existing.dealerId, productId: null, productName: so.productName, type: 'IN' },
    select: { id: true, usedSerialNumbers: true },
  })
  if (sourceHist) {
    const remaining = (sourceHist.usedSerialNumbers || []).filter(sn => !so.manualSerialNumbers.includes(sn))
    await tx.dealerHistoricalStock.update({
      where: { id: sourceHist.id },
      data: { quantity: { increment: so.manualSerialNumbers.length }, usedSerialNumbers: { set: remaining } },
    })
  }
}
    } else {
    for (const stockOut of existing.stockOuts) {
      if (stockOut.serialNumbers.length > 0) {
        await tx.serialNumber.updateMany({
          where: { stockOutId: stockOut.id },
          data: { status: 'AVAILABLE', stockOutId: null },
        })
      }
      if (stockOut.productId) {
        await tx.productStock.update({
          where: { productId_branchId: { productId: stockOut.productId, branchId: existing.branchId } },
          data: { currentStock: { increment: stockOut.quantity } },
        })
      }
    }
  }

  await tx.stockOut.deleteMany({ where: { invoiceId: existing.id } })
}

export const getInvoiceById = async (id, user) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: {
        include: {
          // product relation optional — manual items ke liye null aayega.
          // productName field (StockOut.productName) manual items ka naam carry karta hai.
          product: { include: { category: true } },
          serialNumbers: { select: { id: true, serialNumber: true } },
        },
      },
      dealer: {
        select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true },
      },
      // dealer-invoice serials are linked via dealerInvoiceId (not stockOutId),
      // so the frontend needs this to know which serials are already billed
      // on this invoice for each dealer product.
      dealerSerials: {
        select: { id: true, serialNumber: true, productId: true, historicalStockId: true },
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
        stockOuts: { select: { id: true, quantity: true, productName: true, product: { select: { name: true } } } },
        dealer: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.invoice.count({ where }),
  ])

  return { invoices, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } }
}

// ────────────────────────────────────────────────────────────────────────────
// updateInvoice — now mirrors createInvoice fully:
//  - manual/free-text products (name, price, GST all editable)
//  - dealer invoices (transferred serials + dealer-historical serials/qty)
//  - normal branch stock + serials
// Flow: reverse old item effects → recompute totals from new items →
// update invoice row → re-apply new items via the same shared logic
// createInvoice uses, so edit behaves identically to create.
// ────────────────────────────────────────────────────────────────────────────
export const updateInvoice = async (id, data, user) => {
    const existing = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: { include: { serialNumbers: true } },
    },
  })
  if (!existing) throw { statusCode: 404, message: 'Invoice not found.' }
  if (user.role !== 'SUPER_ADMIN' && existing.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  const {
    customerName, customerPhone, customerEmail,
    customerAddress, customerGST, items, discount = 0,
    notes, terms, date, paymentMode = 'Cash',
    invoiceNumber: newInvoiceNumber,
  } = data

  const branchId = existing.branchId
  const dealerId = data.dealerId !== undefined ? (data.dealerId || null) : (existing.dealerId || null)

  if (dealerId) {
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } })
    if (!dealer) throw { statusCode: 404, message: 'Dealer not found.' }
  }

  const branchSettings = await prisma.settings.findUnique({ where: { branchId } })
  const customModes = branchSettings?.customPaymentModes ?? []
  if (customModes.length > 0 && !customModes.includes(paymentMode)) {
    throw { statusCode: 400, message: `Payment mode "${paymentMode}" is not configured for this branch.` }
  }

  // ✅ Invoice number change ho raha hai to duplicate check karo — ab sab declared hai
  let invoiceNumberToSave = existing.invoiceNumber
  if (newInvoiceNumber?.trim() && newInvoiceNumber.trim() !== existing.invoiceNumber) {
    const dup = await prisma.invoice.findFirst({
      where: { invoiceNumber: newInvoiceNumber.trim(), branchId, NOT: { id } },
    })
    if (dup) throw { statusCode: 400, message: `Invoice number "${newInvoiceNumber}" already exists.` }
    invoiceNumberToSave = newInvoiceNumber.trim()
  }

  if (!items || !items.length) {
    throw { statusCode: 400, message: 'Invoice must have at least one item.' }
  }

  // ── Process new items (same rules as createInvoice — manual products
  //    skip product lookup, real products are re-validated/re-priced) ──────
  let subtotal = 0
  let gstAmount = 0
  const processedItems = []

  for (const item of items) {
    if (!item.productId) {
      const itemTotal = item.sellingPrice * item.quantity
      subtotal += itemTotal
      const itemGST = itemTotal * ((item.gstRate || 0) / 100)
      gstAmount += itemGST
      processedItems.push({ ...item, product: null, gstRate: item.gstRate || 0 })
      continue
    }

    const product = await prisma.product.findUnique({ where: { id: item.productId } })
    if (!product) throw { statusCode: 404, message: `Product not found: ${item.productId}` }

    const itemTotal = item.sellingPrice * item.quantity
     const effectiveGstRate = (item.gstRate !== undefined && item.gstRate !== null)
      ? Number(item.gstRate)
      : product.gstRate

    const itemGST = itemTotal * (effectiveGstRate / 100)
    subtotal += itemTotal
    gstAmount += itemGST
    processedItems.push({ ...item, product, gstRate: effectiveGstRate })
  }

  const totalAmount = subtotal + gstAmount - Number(discount)

  await prisma.$transaction(async (tx) => {
    // STEP 1: undo whatever the old items did (stock/serials/historical qty)
    await reverseInvoiceItems(tx, existing)

    // STEP 2: update the invoice row itself (name/price/GST/customer/etc.)
    await tx.invoice.update({
      where: { id },
      data: {
        invoiceNumber: invoiceNumberToSave,
        customerName, customerPhone, customerEmail,
        customerAddress,
        customerGST: customerGST || null,
        subtotal, gstAmount,
        discount: Number(discount),
        totalAmount,
        notes: notes || null,
        terms: terms || null,
        paymentMode,
        date: date ? new Date(date) : existing.date,
      },
    })

    // STEP 3: re-apply new items with full create-parity logic
    await processInvoiceItems(tx, {
      inv: { id },
      processedItems,
      dealerId,
      branchId,
      customerName, customerPhone, customerEmail, customerAddress,
      notes: notes || null,
      date: date ? new Date(date) : existing.date,
      user,
    })
  }, { timeout: 30000, maxWait: 10000 })

  return getInvoiceById(id, user)
}

export const deleteInvoice = async (id, user) => {
  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: { include: { serialNumbers: true } },
    },
  })
  if (!existing) throw { statusCode: 404, message: 'Invoice not found.' }
  if (user.role !== 'SUPER_ADMIN' && existing.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  await prisma.$transaction(async (tx) => {
    await reverseInvoiceItems(tx, existing)
    await tx.invoice.delete({ where: { id } })
  })

  return { message: 'Invoice deleted successfully.' }
}

export const resetCounter = async (branchId, user) => {
  if (user.role !== 'SUPER_ADMIN' && user.branchId !== branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }
  return resetInvoiceCounter(branchId)
}