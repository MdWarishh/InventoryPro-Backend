import * as taskService from './task.service.js'
import { sendSuccess } from '../../utils/response.js'

export const createTask = async (req, res) => {
  const task = await taskService.createTask(req.user, req.body)
  sendSuccess(res, task, 'Task created successfully.', 201)
}

export const getMyTasks = async (req, res) => {
  const data = await taskService.getMyTasks(req.user.id, req.query)
  sendSuccess(res, data)
}

export const getAllTasks = async (req, res) => {
  const data = await taskService.getAllTasks(req.user, req.query)
  sendSuccess(res, data)
}

export const getTaskById = async (req, res) => {
  const task = await taskService.getTaskById(req.params.id, req.user)
  sendSuccess(res, task)
}

export const updateTask = async (req, res) => {
  const task = await taskService.updateTask(req.params.id, req.user, req.body)
  sendSuccess(res, task, 'Task updated successfully.')
}

export const deleteTask = async (req, res) => {
  await taskService.deleteTask(req.params.id, req.user)
  sendSuccess(res, null, 'Task deleted successfully.')
}

export const addComment = async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) {
    return res.status(400).json({ success: false, message: 'Comment content is required.' })
  }
  const comment = await taskService.addComment(req.params.id, req.user.id, content)
  sendSuccess(res, comment, 'Comment added.', 201)
}

export const getScoreboard = async (req, res) => {
  const branchId = req.user.role === 'SUPER_ADMIN'
    ? (req.query.branchId || req.user.branchId)
    : req.user.branchId
  const data = await taskService.getScoreboard(branchId)
  sendSuccess(res, data)
}

export const getTaskStats = async (req, res) => {
  const data = await taskService.getTaskStats(req.query.userId, req.user)
  sendSuccess(res, data)
}