import prisma from '../../config/db.js'
import { generateInvoiceNumber, resetInvoiceCounter } from '../../utils/generateInvoiceNo.js'

export const createInvoice = async (data, user) => {
  const {
    branchId, customerName, customerPhone, customerEmail,
    customerAddress, customerGST, items, discount = 0, notes, terms, date,
    paymentMode = 'Cash',
    dealerId = null,
    isDealerInvoice = false,
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

  const invoiceNumber = await generateInvoiceNumber(branchId)

  let subtotal = 0
  let gstAmount = 0
  const processedItems = []

  for (const item of items) {
    // Manual/historical free-text products ka productId null hoga
    // Unke liye product lookup skip karo
    if (!item.productId) {
      // Manual product — no DB lookup needed
      const itemTotal = item.sellingPrice * item.quantity
      subtotal += itemTotal
      // gstRate 0 assume karo manual products ke liye (ya item.gstRate use karo agar frontend bheje)
      const itemGST = itemTotal * ((item.gstRate || 0) / 100)
      gstAmount += itemGST
      processedItems.push({ ...item, product: null, gstRate: item.gstRate || 0 })
      continue
    }

    const product = await prisma.product.findUnique({ where: { id: item.productId } })
    if (!product) throw { statusCode: 404, message: `Product not found: ${item.productId}` }

    const itemTotal = item.sellingPrice * item.quantity
    const itemGST = itemTotal * (product.gstRate / 100)
    subtotal += itemTotal
    gstAmount += itemGST
    processedItems.push({ ...item, product, gstRate: product.gstRate })
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

    for (const item of processedItems) {

      // ── DEALER INVOICE PATH ────────────────────────────────────────────────
      if (dealerId) {

        // ── Serial IDs ko teen categories mein classify karo ──────────────────
        // 1. transferredIds  → normal inventory serials (TRANSFERRED status)
        // 2. historicalIds   → DEALER_HISTORICAL status wale real SerialNumber records
        // 3. manualEntries   → hist_ prefix wale free-text manual serials

        const allSerialIds = item.serialNumberIds || []

        const transferredIds = []
        const historicalIds  = []
        const manualEntries  = [] // { histId, sn }

        for (const sid of allSerialIds) {
          if (sid.startsWith('hist_')) {
            // Manual free-text serial — format: hist_{histId}_{serialNumber}
            const parts = sid.split('_')
            const histId = parts[1]
            const sn = parts.slice(2).join('_')
            manualEntries.push({ histId, sn })
          } else {
            // Real SerialNumber record — check status to classify
            // Abhi sirf ID hai, status baad mein DB se aayega
            // Temporary dono lists mein daalo, filter neeche hoga
            transferredIds.push(sid)
          }
        }

        // Real serial IDs mein se TRANSFERRED vs DEALER_HISTORICAL sort karo
        if (transferredIds.length) {
          const realSerials = await tx.serialNumber.findMany({
            where: { id: { in: transferredIds } },
            select: { id: true, status: true },
          })
          for (const s of realSerials) {
            if (s.status === 'DEALER_HISTORICAL') {
              historicalIds.push(s.id)
              // transferredIds se hata do
              const idx = transferredIds.indexOf(s.id)
              if (idx !== -1) transferredIds.splice(idx, 1)
            }
            // TRANSFERRED wale transferredIds mein hi rahenge
          }
        }

        // ── 1. TRANSFERRED serials (inventory wala flow) ──────────────────────
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
              message: `Some serial numbers for "${item.product?.name}" are already billed or not available.`,
            }
          }

          // Verify dealer ownership via stockIn
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

        // ── 2. DEALER_HISTORICAL serials (add historical stock wala flow) ──────
        if (historicalIds.length) {
          // Verify ye serials is dealer ke hain
          const historicalSerials = await tx.serialNumber.findMany({
            where: {
              id: { in: historicalIds },
              status: 'DEALER_HISTORICAL',
            },
            select: { id: true, serialNumber: true, historicalStockId: true, dealerBillingStatus: true },
          })

          if (historicalSerials.length !== historicalIds.length) {
            throw {
              statusCode: 400,
              message: `Some historical serial numbers are not available.`,
            }
          }

          // BILLED check
          const alreadyBilled = historicalSerials.filter(
            s => s.dealerBillingStatus === 'BILLED'
          )
          if (alreadyBilled.length) {
            throw {
              statusCode: 400,
              message: `Some historical serial numbers are already billed.`,
            }
          }

          // SOLD + BILLED mark karo
          await tx.serialNumber.updateMany({
            where: { id: { in: historicalIds } },
            data: {
              status: 'SOLD',
              dealerBillingStatus: 'BILLED',
              dealerInvoiceId: inv.id,
            },
          })

          // DealerHistoricalStock mein quantity deduct + usedSerialNumbers update
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

        // ── 3. Manual free-text serials (hist_ prefix) ────────────────────────
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

        // ── 4. Manual product WITHOUT serials — historical quantity deduct ──────
        // productId null hai aur koi serial nahi diya
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
            throw {
              statusCode: 400,
              message: `Insufficient historical stock for "${item.productName}".`,
            }
          }
        }

        // ── StockOut record create (invoice relation ke liye) ─────────────────
        // ✅ CHANGED: Ab manual products (productId: null) ke liye bhi StockOut
        // banega — productId nullable ho gaya hai schema mein, aur productName
        // store karenge taaki dealer stats / Sales tab mein manual sales bhi dikhein.
        await tx.stockOut.create({
          data: {
            productId: item.productId || null,
            productName: item.productId ? null : item.productName,
            branchId,
            quantity: Number(item.quantity),
            sellingPrice: Number(item.sellingPrice),
            customerName, customerPhone, customerEmail, customerAddress,
            invoiceId: inv.id,
            notes,
            date: date ? new Date(date) : new Date(),
            createdBy: user.id,
          },
        })

        // NOTE: productStock NOT decremented — already done at dealer StockIn time

      } else {
        // ── NORMAL INVOICE PATH (existing logic — untouched) ──────────────────
        const stockOutData = {
          productId: item.productId,
          branchId,
          quantity: Number(item.quantity),
          sellingPrice: Number(item.sellingPrice),
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
          throw { statusCode: 400, message: `Insufficient stock for: ${item.product.name}` }
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

    return inv
  })

  return getInvoiceById(invoice.id, user)
}


export const getInvoiceById = async (id, user) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: {
        include: {
          // ✅ product relation ab optional hai — manual items ke liye null aayega.
          // productName field (StockOut.productName) manual items ka naam carry karta hai.
          product: { include: { category: true } },
          serialNumbers: { select: { id: true, serialNumber: true } },
        },
      },
      dealer: {
        select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstNumber: true },
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

  // NEW: filter by dealer
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
        // ✅ CHANGED: productName add kiya select mein, taaki manual product
        // wale stockOuts ka naam bhi list view mein dikhe (product null hone par)
        stockOuts: { select: { id: true, quantity: true, productName: true, product: { select: { name: true } } } },
        dealer: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.invoice.count({ where }),
  ])

  return { invoices, pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) } }
}

export const updateInvoice = async (id, data, user) => {
  // ── Fetch existing invoice ────────────────────────────────────────────────
  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: {
        include: {
          serialNumbers: true,
        },
      },
    },
  })
  if (!existing) throw { statusCode: 404, message: 'Invoice not found.' }
  if (user.role !== 'SUPER_ADMIN' && existing.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  // Dealer invoice edit abhi support nahi — alag logic chahiye
  if (existing.dealerId) {
    throw { statusCode: 400, message: 'Dealer invoices cannot be edited yet.' }
  }

  const {
    customerName, customerPhone, customerEmail,
    customerAddress, customerGST, items, discount = 0,
    notes, terms, date, paymentMode = 'Cash',
  } = data

  const branchId = existing.branchId

  // ── Validate payment mode ─────────────────────────────────────────────────
  const branchSettings = await prisma.settings.findUnique({ where: { branchId } })
  const customModes = branchSettings?.customPaymentModes ?? []
  if (customModes.length > 0 && !customModes.includes(paymentMode)) {
    throw { statusCode: 400, message: `Payment mode "${paymentMode}" is not configured for this branch.` }
  }

  // ── Process new items ─────────────────────────────────────────────────────
  let subtotal = 0
  let gstAmount = 0
  const processedItems = []

  for (const item of items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } })
    if (!product) throw { statusCode: 404, message: `Product not found: ${item.productId}` }

    const itemTotal = item.sellingPrice * item.quantity
    const itemGST = itemTotal * (product.gstRate / 100)
    subtotal += itemTotal
    gstAmount += itemGST
    processedItems.push({ ...item, product, gstRate: product.gstRate })
  }

  const totalAmount = subtotal + gstAmount - Number(discount)

  await prisma.$transaction(async (tx) => {

    // ── STEP 1: Purane stockOuts ke serials AVAILABLE wapas karo ─────────────
    for (const oldStockOut of existing.stockOuts) {
      // Serial numbers ko wapas AVAILABLE karo
      if (oldStockOut.serialNumbers.length > 0) {
        await tx.serialNumber.updateMany({
          where: { stockOutId: oldStockOut.id },
          data: { status: 'AVAILABLE', stockOutId: null },
        })
      }

      // ProductStock increment karo (jo decrement hua tha)
      await tx.productStock.update({
        where: { productId_branchId: { productId: oldStockOut.productId, branchId } },
        data: { currentStock: { increment: oldStockOut.quantity } },
      })
    }

    // ── STEP 2: Purane stockOuts delete karo ─────────────────────────────────
    await tx.stockOut.deleteMany({ where: { invoiceId: id } })

    // ── STEP 3: Invoice update karo ───────────────────────────────────────────
    await tx.invoice.update({
      where: { id },
      data: {
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

    // ── STEP 4: Naye stockOuts create karo ───────────────────────────────────
    for (const item of processedItems) {
      // Stock check
      const currentStock = await tx.productStock.findUnique({
        where: { productId_branchId: { productId: item.productId, branchId } },
      })
      if (!currentStock || currentStock.currentStock < item.quantity) {
        throw { statusCode: 400, message: `Insufficient stock for: ${item.product.name}` }
      }

      const stockOut = await tx.stockOut.create({
        data: {
          productId: item.productId,
          branchId,
          quantity: Number(item.quantity),
          sellingPrice: Number(item.sellingPrice),
          customerName, customerPhone, customerEmail, customerAddress,
          invoiceId: id,
          notes: notes || null,
          date: date ? new Date(date) : existing.date,
          createdBy: existing.createdBy,
        },
      })

      // Serial numbers SOLD mark karo
      if (item.serialNumberIds?.length) {
        await tx.serialNumber.updateMany({
          where: { id: { in: item.serialNumberIds } },
          data: { status: 'SOLD', stockOutId: stockOut.id },
        })
      }

      // Stock decrement
      await tx.productStock.update({
        where: { productId_branchId: { productId: item.productId, branchId } },
        data: { currentStock: { decrement: Number(item.quantity) } },
      })
    }
  },{ timeout: 30000, maxWait: 10000 })

  return getInvoiceById(id, user)
}

export const deleteInvoice = async (id, user) => {
  const existing = await prisma.invoice.findUnique({
    where: { id },
    include: {
      stockOuts: {
        include: { serialNumbers: true },
      },
    },
  })
  if (!existing) throw { statusCode: 404, message: 'Invoice not found.' }
  if (user.role !== 'SUPER_ADMIN' && existing.branchId !== user.branchId) {
    throw { statusCode: 403, message: 'Access denied.' }
  }

  // Dealer invoice delete — serials TRANSFERRED wapas, dealerBillingStatus null
  const isDealerInvoice = !!existing.dealerId

  await prisma.$transaction(async (tx) => {

    for (const stockOut of existing.stockOuts) {
      if (isDealerInvoice) {
        // Dealer serials — SOLD → TRANSFERRED wapas, billing status UNBILLED
        if (stockOut.serialNumbers.length > 0) {
          await tx.serialNumber.updateMany({
            where: { dealerInvoiceId: id },
            data: {
              status: 'TRANSFERRED',
              dealerBillingStatus: 'UNBILLED',
              dealerInvoiceId: null,
            },
          })
        }
        // Dealer invoice mein productStock deduct nahi hua tha — increment mat karo
        // NOTE: Manual/historical product stockOuts ke liye historicalStock.quantity
        // wapas increment nahi ho raha abhi — yeh ek known gap hai (delete flow),
        // alag se discuss karke fix karenge agar dealer invoice delete use karte ho.
      } else {
        // Normal invoice — serials AVAILABLE wapas, stock increment
        if (stockOut.serialNumbers.length > 0) {
          await tx.serialNumber.updateMany({
            where: { stockOutId: stockOut.id },
            data: { status: 'AVAILABLE', stockOutId: null },
          })
        }
        await tx.productStock.update({
          where: { productId_branchId: { productId: stockOut.productId, branchId: existing.branchId } },
          data: { currentStock: { increment: stockOut.quantity } },
        })
      }
    }

    // StockOuts delete
    await tx.stockOut.deleteMany({ where: { invoiceId: id } })

    // Invoice delete
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