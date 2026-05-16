import prisma from '../../config/db.js'
import resend from '../../config/resend.js'
import { lowStockTemplate } from '../../utils/emailTemplates.js'
import { sseManager } from '../../sse/sse.manager.js'

export const createNotification = async ({ userId, title, message, type, relatedId }) => {
  const notification = await prisma.notification.create({
    data: { userId, title, message, type, relatedId },
  })
  sseManager.sendToUser(userId, { type: 'notification', data: notification })
  return notification
}

export const getNotifications = async (userId, { page = 1, limit = 20, unreadOnly, type } = {}) => {
  const skip = (page - 1) * Number(limit)

  const where = { userId }
  if (unreadOnly === 'true') where.isRead = false
  if (type) where.type = type   // ← type filter add kiya

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where }),
    // unreadCount hamesha full hoga — type filter ke baad nahi
    prisma.notification.count({ where: { userId, isRead: false } }),
  ])

  return {
    notifications,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    },
    unreadCount,
  }
}

export const markAsRead = async (id, userId) => {
  const notification = await prisma.notification.findFirst({ where: { id, userId } })
  if (!notification) throw { statusCode: 404, message: 'Notification not found.' }
  return prisma.notification.update({ where: { id }, data: { isRead: true } })
}

export const markAllAsRead = async (userId) => {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  })
}

export const deleteNotification = async (id, userId) => {
  await prisma.notification.deleteMany({ where: { id, userId } })
}

export const sendLowStockNotification = async (product, branchName, currentStock, userId) => {
  await createNotification({
    userId,
    title: 'Low Stock Alert',
    message: `${product.name} is running low. Current stock: ${currentStock} (Min: ${product.minStockAlert})`,
    type: 'LOW_STOCK',
    relatedId: product.id,
  })

  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'BRANCH_ADMIN'] }, isActive: true },
    select: { email: true, name: true },
  })

  const { subject, html } = lowStockTemplate({
    productName: product.name,
    branchName,
    currentStock,
    minStock: product.minStockAlert,
  })

  for (const admin of admins) {
    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'noreply@inventory.com',
        to: admin.email,
        subject,
        html,
      })
    } catch (err) {
      console.error('Email send error:', err.message)
    }
  }
}