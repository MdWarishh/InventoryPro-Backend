import prisma from '../../config/db.js'
import { generateSKU } from '../../utils/generateSKU.js'

export const getAllProducts = async (user, { page = 1, limit = 20, search, categoryId, branchId, lowStock } = {}) => {
  const skip = (page - 1) * limit
  const where = { isActive: true }

  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { sku: { contains: search, mode: 'insensitive' } },
    { barcode: { contains: search, mode: 'insensitive' } },
  ]
  if (categoryId) where.categoryId = categoryId

  const products = await prisma.product.findMany({
    where,
    skip,
    take: Number(limit),
    include: {
      category: { select: { id: true, name: true, color: true } },
      productStocks: {
        where: user.role === 'SUPER_ADMIN'
          ? (branchId ? { branchId } : {})
          : { branchId: user.branchId },
        include: { branch: { select: { id: true, name: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const filtered = lowStock === 'true'
    ? products.filter(p => p.productStocks.some(s => s.currentStock <= p.minStockAlert))
    : products

  const total = await prisma.product.count({ where })

  return {
    products: filtered,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
  }
}

export const getProductById = async (id, user) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      productStocks: {
        where: user.role === 'SUPER_ADMIN' ? {} : { branchId: user.branchId },
        include: { branch: { select: { id: true, name: true } } },
      },
      serialNumbers: {
        where: {
          status: 'AVAILABLE',
          ...(user.role !== 'SUPER_ADMIN' && { branchId: user.branchId }),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }
  return product
}

export const createProduct = async (data, user) => {
  const { name, sku, description, categoryId, unit, purchasePrice, sellingPrice, gstRate, hsnCode, minStockAlert, images, barcode, hasSerialNumbers } = data

  const finalSKU = sku || await generateSKU(data.categoryName)

  const existing = await prisma.product.findUnique({ where: { sku: finalSKU } })
  if (existing) throw { statusCode: 409, message: 'SKU already exists.' }

  const product = await prisma.product.create({
    data: {
      name, sku: finalSKU, description, categoryId,
      unit: unit || 'pcs',
      purchasePrice: Number(purchasePrice) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      gstRate: Number(gstRate) || 18,
      hsnCode, minStockAlert: Number(minStockAlert) || 10,
      images: images || [], barcode,
      hasSerialNumbers: hasSerialNumbers === true || hasSerialNumbers === 'true',
    },
    include: { category: true },
  })

  // SUPER_ADMIN ke liye saari branches me stock, baaki ke liye sirf apni branch
  if (user.role === 'SUPER_ADMIN') {
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })
    await prisma.productStock.createMany({
      data: branches.map(b => ({ productId: product.id, branchId: b.id, currentStock: 0 })),
      skipDuplicates: true,
    })
  } else if (user.branchId) {
    await prisma.productStock.create({
      data: { productId: product.id, branchId: user.branchId, currentStock: 0 },
    })
  }

  return product
}

export const updateProduct = async (id, data) => {
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }

  if (data.sku && data.sku !== product.sku) {
    const existing = await prisma.product.findUnique({ where: { sku: data.sku } })
    if (existing) throw { statusCode: 409, message: 'SKU already exists.' }
  }

  return prisma.product.update({
    where: { id },
    data: {
      name: data.name,
      sku: data.sku,
      description: data.description,
      categoryId: data.categoryId,
      unit: data.unit,
      purchasePrice: data.purchasePrice !== undefined ? Number(data.purchasePrice) : undefined,
      sellingPrice: data.sellingPrice !== undefined ? Number(data.sellingPrice) : undefined,
      gstRate: data.gstRate !== undefined ? Number(data.gstRate) : undefined,
      hsnCode: data.hsnCode,
      minStockAlert: data.minStockAlert !== undefined ? Number(data.minStockAlert) : undefined,
      images: data.images,
      barcode: data.barcode,
      hasSerialNumbers: data.hasSerialNumbers,
    },
    include: { category: true },
  })
}

export const deleteProduct = async (id) => {
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) throw { statusCode: 404, message: 'Product not found.' }
  await prisma.product.update({ where: { id }, data: { isActive: false } })
}

export const searchProducts = async (query, user) => {
  const branchFilter = user.role === 'SUPER_ADMIN' ? {} : { branchId: user.branchId }
  return prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { sku: { contains: query, mode: 'insensitive' } },
        { barcode: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
      productStocks: { where: branchFilter, include: { branch: { select: { id: true, name: true } } } },
    },
    take: 20,
  })
}