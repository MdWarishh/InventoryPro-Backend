import * as notificationsService from './notifications.service.js'
import { sendSuccess } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const result = await notificationsService.getNotifications(req.user.id, req.query)
  sendSuccess(res, result)
}

export const markRead = async (req, res) => {
  await notificationsService.markAsRead(req.params.id, req.user.id)
  sendSuccess(res, null, 'Notification marked as read.')
}

export const markAllRead = async (req, res) => {
  await notificationsService.markAllAsRead(req.user.id)
  sendSuccess(res, null, 'All notifications marked as read.')
}

export const remove = async (req, res) => {
  await notificationsService.deleteNotification(req.params.id, req.user.id)
  sendSuccess(res, null, 'Notification deleted.')
}