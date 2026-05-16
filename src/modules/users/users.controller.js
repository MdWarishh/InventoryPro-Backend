import * as usersService from './users.service.js'
import { sendSuccess, sendError, sendPaginated } from '../../utils/response.js'

export const getAll = async (req, res) => {
  const result = await usersService.getAllUsers(req.user, req.query)
  sendPaginated(res, result.users, result.pagination)
}

export const create = async (req, res) => {
  const user = await usersService.createUser(req.body, req.user)
  sendSuccess(res, user, 'User created successfully.', 201)
}

export const update = async (req, res) => {
  const user = await usersService.updateUser(req.params.id, req.body, req.user)
  sendSuccess(res, user, 'User updated successfully.')
}

export const remove = async (req, res) => {
  await usersService.deleteUser(req.params.id, req.user)
  sendSuccess(res, null, 'User deactivated successfully.')
}

export const resetPassword = async (req, res) => {
  const { newPassword } = req.body
  if (!newPassword || newPassword.length < 6) return sendError(res, 'Password must be at least 6 characters.', 400)
  await usersService.resetUserPassword(req.params.id, newPassword)
  sendSuccess(res, null, 'Password reset successfully.')
}

export const getPermissions = async (req, res) => {
  const permissions = await usersService.getUserPermissions(req.params.id)
  sendSuccess(res, permissions, 'Permissions fetched successfully.')
}

export const getProfile = async (req, res) => {
  const user = await usersService.getProfile(req.user.id)
  sendSuccess(res, user)
}

export const updateProfile = async (req, res) => {
  const user = await usersService.updateProfile(req.user.id, req.body)
  sendSuccess(res, user, 'Profile updated successfully.')
}