import prisma from '../../config/db.js'

export const getAllCategories = async (user, { search } = {}) => {
  const where = {}
  if (user.role !== 'SUPER_ADMIN') where.OR = [{ branchId: user.branchId }, { branchId: null }]
  if (search) where.name = { contains: search, mode: 'insensitive' }

  return prisma.category.findMany({
    where,
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  })
}

export const createCategory = async (data, user) => {
  return prisma.category.create({
    data: {
      name: data.name,
      description: data.description,
      color: data.color || '#6366f1',
      branchId: user.role === 'SUPER_ADMIN' ? (data.branchId || null) : user.branchId,
    },
  })
}

export const updateCategory = async (id, data) => {
  const cat = await prisma.category.findUnique({ where: { id } })
  if (!cat) throw { statusCode: 404, message: 'Category not found.' }
  return prisma.category.update({ where: { id }, data: { name: data.name, description: data.description, color: data.color } })
}

export const deleteCategory = async (id) => {
  const count = await prisma.product.count({ where: { categoryId: id } })
  if (count > 0) throw { statusCode: 400, message: `Cannot delete category with ${count} products. Reassign products first.` }
  await prisma.category.delete({ where: { id } })
}