import prisma from '../../config/db.js'
import { parseExcelFile, generateExcelTemplate } from '../../utils/excelParser.js'
import { generateSKU } from '../../utils/generateSKU.js'
import bcrypt from 'bcryptjs'

const validateRow = (row, required) => {
  const errors = []
  for (const field of required) {
    const key = field.replace('*', '')
    if (!row[field] && !row[key]) errors.push(`${key} is required`)
  }
  return errors
}

export const bulkUploadProducts = async (buffer, user) => {
  const rows = parseExcelFile(buffer)
  const results = { success: 0, failed: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    try {
      const name = row['name*'] || row['name']
      const purchasePrice = row['purchasePrice*'] || row['purchasePrice']
      const sellingPrice = row['sellingPrice*'] || row['sellingPrice']

      if (!name) throw new Error('name is required')
      if (!purchasePrice) throw new Error('purchasePrice is required')
      if (!sellingPrice) throw new Error('sellingPrice is required')

      let categoryId = null
      if (row.categoryName) {
        const cat = await prisma.category.findFirst({
          where: { name: { equals: row.categoryName, mode: 'insensitive' } },
        })
        categoryId = cat?.id || null
      }

      let sku = row.sku || row['sku']
      if (!sku) sku = await generateSKU(row.categoryName || 'GEN')

      const existing = await prisma.product.findUnique({ where: { sku } })
      if (existing) throw new Error(`SKU "${sku}" already exists`)

      const product = await prisma.product.create({
        data: {
          name: String(name),
          sku,
          description: row.description || null,
          categoryId,
          unit: row.unit || 'pcs',
          purchasePrice: Number(purchasePrice),
          sellingPrice: Number(sellingPrice),
          gstRate: Number(row.gstRate) || 18,
          hsnCode: row.hsnCode || null,
          minStockAlert: Number(row.minStockAlert) || 10,
          hasSerialNumbers: String(row.hasSerialNumbers).toLowerCase() === 'true',
          images: [],
        },
      })

      const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })
      await prisma.productStock.createMany({
        data: branches.map(b => ({ productId: product.id, branchId: b.id, currentStock: 0 })),
        skipDuplicates: true,
      })

      results.success++
    } catch (err) {
      results.failed++
      results.errors.push({ row: rowNum, data: row.name || 'Unknown', error: err.message })
    }
  }

  await prisma.bulkUploadLog.create({
    data: {
      type: 'PRODUCTS',
      fileName: 'bulk-upload.xlsx',
      totalRows: rows.length,
      successRows: results.success,
      failedRows: results.failed,
      errorDetails: results.errors,
      uploadedBy: user.id,
      branchId: user.branchId || null,
    },
  })

  return results
}

export const bulkUploadStockIn = async (buffer, user) => {
  const rows = parseExcelFile(buffer)
  const results = { success: 0, failed: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    try {
      const sku = row['sku*'] || row['sku']
      const branchName = row['branchName*'] || row['branchName']
      const quantity = row['quantity*'] || row['quantity']
      const purchasePrice = row['purchasePrice*'] || row['purchasePrice']

      if (!sku) throw new Error('sku is required')
      if (!branchName) throw new Error('branchName is required')
      if (!quantity) throw new Error('quantity is required')
      if (!purchasePrice) throw new Error('purchasePrice is required')

      const product = await prisma.product.findUnique({ where: { sku: String(sku) } })
      if (!product) throw new Error(`Product with SKU "${sku}" not found`)

      const branch = await prisma.branch.findFirst({
        where: { name: { equals: String(branchName), mode: 'insensitive' }, isActive: true },
      })
      if (!branch) throw new Error(`Branch "${branchName}" not found`)

      if (user.role !== 'SUPER_ADMIN' && branch.id !== user.branchId) {
        throw new Error('No access to this branch')
      }

      let dealerId = null
      if (row.dealerName) {
        const dealer = await prisma.dealer.findFirst({
          where: { name: { equals: String(row.dealerName), mode: 'insensitive' } },
        })
        dealerId = dealer?.id || null
      }

      const serialNumbers = row.serialNumbers
        ? String(row.serialNumbers).split(',').map(s => s.trim()).filter(Boolean)
        : []

      const stockIn = await prisma.stockIn.create({
        data: {
          productId: product.id,
          branchId: branch.id,
          quantity: Number(quantity),
          purchasePrice: Number(purchasePrice),
          dealerId,
          sourceNote: row.sourceNote || null,
          referenceNo: row.referenceNo || null,
          date: row.date ? new Date(row.date) : new Date(),
          createdBy: user.id,
        },
      })

      if (serialNumbers.length) {
        await prisma.serialNumber.createMany({
          data: serialNumbers.map(sn => ({
            serialNumber: sn,
            productId: product.id,
            branchId: branch.id,
            status: 'AVAILABLE',
            stockInId: stockIn.id,
          })),
          skipDuplicates: true,
        })
      }

      await prisma.productStock.upsert({
        where: { productId_branchId: { productId: product.id, branchId: branch.id } },
        update: { currentStock: { increment: Number(quantity) } },
        create: { productId: product.id, branchId: branch.id, currentStock: Number(quantity) },
      })

      results.success++
    } catch (err) {
      results.failed++
      results.errors.push({ row: rowNum, data: row['sku*'] || row.sku || 'Unknown', error: err.message })
    }
  }

  await prisma.bulkUploadLog.create({
    data: {
      type: 'STOCK_IN',
      fileName: 'bulk-stock-in.xlsx',
      totalRows: rows.length,
      successRows: results.success,
      failedRows: results.failed,
      errorDetails: results.errors,
      uploadedBy: user.id,
      branchId: user.branchId || null,
    },
  })

  return results
}

export const bulkUploadDealers = async (buffer, user) => {
  const rows = parseExcelFile(buffer)
  const results = { success: 0, failed: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    try {
      const name = row['name*'] || row['name']
      if (!name) throw new Error('name is required')

      await prisma.dealer.create({
        data: {
          name: String(name),
          phone: row.phone ? String(row.phone) : null,
          email: row.email || null,
          address: row.address || null,
          city: row.city || null,
          state: row.state || null,
          gstNumber: row.gstNumber || null,
          bankAccount: row.bankAccount ? String(row.bankAccount) : null,
          bankName: row.bankName || null,
          ifscCode: row.ifscCode || null,
        },
      })

      results.success++
    } catch (err) {
      results.failed++
      results.errors.push({ row: rowNum, data: row['name*'] || row.name || 'Unknown', error: err.message })
    }
  }

  await prisma.bulkUploadLog.create({
    data: {
      type: 'DEALERS',
      fileName: 'bulk-dealers.xlsx',
      totalRows: rows.length,
      successRows: results.success,
      failedRows: results.failed,
      errorDetails: results.errors,
      uploadedBy: user.id,
    },
  })

  return results
}

export const getUploadHistory = async (user) => {
  const where = user.role === 'SUPER_ADMIN' ? {} : { uploadedBy: user.id }
  return prisma.bulkUploadLog.findMany({
    where,
    include: { uploadedByUser: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export const getTemplate = (type) => {
  return generateExcelTemplate(type)
}