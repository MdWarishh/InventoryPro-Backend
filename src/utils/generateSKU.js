import prisma from '../config/db.js'

export const generateSKU = async (categoryName = 'GEN') => {
  const prefix = categoryName.substring(0, 3).toUpperCase()
  const timestamp = Date.now().toString().slice(-6)
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0')
  const sku = `${prefix}-${timestamp}-${random}`

  const existing = await prisma.product.findUnique({ where: { sku } })
  if (existing) return generateSKU(categoryName)

  return sku
}